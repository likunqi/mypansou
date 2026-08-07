// server/tasks/resource_collect.js — 每日资源采集流水线（8-07 新增）
// 任务类型 resource_collect：每日 03:00 自动执行，内部五阶段：
//   ① 词库同步：豆瓣榜单灌词 + 预置分类种子词补缺 + 热搜词清洗导入
//   ② 取今日额度词（按权重轮换，未采集优先）
//   ③ site 采集：Bing 搜 site:pan.quark.cn / site:pan.baidu.com 提取分享链接
//   ④ SeedHub 豆瓣资料增量同步（限量）
//   ⑤ 汇总写日志（入库走现有 resourceAdd 去重 + link_valid 后续检测）
// task_config: { daily_limit: 200, seedhub_limit: 30, interval_ms: 2000 }
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const engine = require("../../lib/crawler-engine");
const seedhub = require("../../lib/seedhub");
const pansou = require("../../lib/sources/pansou");
const { getDoubanHot } = require("../handlers/douban");

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---- 预置分类种子词（非影视类为主，影视由豆瓣榜单覆盖）----
const PRESET_KEYWORDS = [
  ["Photoshop", "软件"], ["Office 2024", "软件"], ["剪映专业版", "软件"], ["AutoCAD", "软件"], ["SolidWorks", "软件"],
  ["Premiere Pro", "软件"], ["After Effects", "软件"], ["达芬奇", "软件"], ["3ds Max", "软件"], ["CorelDRAW", "软件"],
  ["黑神话悟空", "游戏"], ["赛博朋克2077", "游戏"], ["艾尔登法环", "游戏"], ["荒野大镖客2", "游戏"], ["博德之门3", "游戏"],
  ["GTA5", "游戏"], ["巫师3", "游戏"], ["双人成行", "游戏"], ["原神", "游戏"], ["星露谷物语", "游戏"],
  ["Python 教程", "教程"], ["Java 教程", "教程"], ["前端开发", "教程"], ["机器学习", "教程"], ["摄影教程", "教程"],
  ["剪辑教程", "教程"], ["英语四六级", "教程"], ["考研资料", "教程"], ["公务员考试", "教程"], ["注册会计师", "教程"],
  ["教师资格证", "资料"], ["一级建造师", "资料"], ["二级建造师", "资料"], ["医学考试", "资料"], ["计算机二级", "资料"],
  ["心理咨询师", "资料"], ["法考", "资料"], ["会计初级", "资料"], ["高中网课", "资料"], ["小学网课", "资料"],
];

// ---- 热搜词清洗：滤掉测试词/纯数字/标点脏/资源修饰串 ----
const STOP_WORDS = ["测试", "test", "abc", "资源", "网盘", "下载", "分享", "链接"];
const MODIFIERS = /\b(4K|HD|HDR|1080P|720P|2160P|REMUX|WEB-DL|蓝光|原盘|中字|国语|粤语|内嵌|简中|繁中|60FPS|DTS|无水印|完整版|典藏版|收藏版|合集|全集|已完结|完结|番外|剧场版|加长版|更新至|更新到|全\d+集|第.*季)\b/gi;
function cleanHotword(kw) {
  var s = String(kw || "").trim();
  if (s.length < 2 || s.length > 30) return "";
  if (/^\d+$/.test(s)) return "";                                   // 纯数字
  if (/[《》【】\[\]（）()]|[*#_@!？?。，、]$/.test(s) || /^[《》【】]/.test(s)) return ""; // 带括号/特殊符号
  if (/[a-zA-Z]{2,}\d{4,}/.test(s) && !/[\u4e00-\u9fa5]/.test(s)) return ""; // 纯乱码串
  s = s.replace(/[，。、,.;；：:！!？?]+$/g, "").trim();
  if (s.length < 2) return "";
  s = s.replace(MODIFIERS, " ").replace(/\s+/g, " ").trim();       // 去资源修饰词
  if (s.length < 2) return "";
  for (var i = 0; i < STOP_WORDS.length; i++) {
    if (s === STOP_WORDS[i] || s.indexOf(STOP_WORDS[i] + " ") === 0) return "";
  }
  return s;
}

// ① 词库同步：返回各来源新增数
async function syncKeywords() {
  var report = { douban: 0, preset: 0, hotword: 0 };
  try {
    var data = await getDoubanHot();
    var items = (data && data.items) || [];
    var list = items.slice(0, 20).map(function (m) { return { keyword: String(m.title || "").trim(), category: "影视", source: "douban", weight: 20 }; }).filter(function (x) { return x.keyword; });
    var r1 = await mysql.keywordCrawlerImport(list);
    report.douban = r1.inserted;
  } catch (e) { report.douban = "err:" + e.message; }
  var preset = PRESET_KEYWORDS.map(function (p) { return { keyword: p[0], category: p[1], source: "preset", weight: 15 }; });
  var r2 = await mysql.keywordCrawlerImport(preset);
  report.preset = r2.inserted;
  try {
    var hots = await mysql.query("SELECT keyword, search_count FROM search_keywords WHERE status=1 AND search_count>=1 LIMIT 500");
    var clean = [];
    (hots || []).forEach(function (h) {
      var k = cleanHotword(h.keyword);
      if (k) clean.push({ keyword: k, category: "综合", source: "hotword", weight: 12 });
    });
    var r3 = await mysql.keywordCrawlerImport(clean);
    report.hotword = r3.inserted;
  } catch (e) { report.hotword = "err:" + e.message; }
  return report;
}

// ③-a 盘搜源采集（主力通道）：词库关键词 → pansou 聚合 API → 网盘链接入库
// pansou 返回 {items:[{title,url,pwd,disk_type}]}，走现有 resourceExists 去重
async function collectPansou(keyword) {
  var r = await pansou.search(keyword);
  if (!r.ok || !r.items || !r.items.length) return { links: 0, inserted: 0, dup: 0, error: r.ok ? undefined : r.error };
  var inserted = 0, dupCount = 0;
  for (var i = 0; i < r.items.length; i++) {
    var it = r.items[i];
    if (!it || !it.url) continue;
    try {
      var dup = await store.resourceExists(it.url);
      if (dup) { dupCount++; continue; }
      await store.resourceAdd({
        title: String(it.title || keyword).slice(0, 200),
        url: it.url,
        password: it.pwd || "",
        disk_type: it.disk_type || "quark",
        category: "综合",
        description: "盘搜采集：" + keyword,
        source: "collected", status: 1,
      });
      inserted++;
    } catch (e) {}
  }
  return { links: r.items.length, inserted: inserted, dup: dupCount };
}

// ③-b site 采集（Bing 直链解析；实测 Bing 对网盘分享链接收录极少，产出低，默认关闭，仅作对比基线）
async function collectSite(keyword, site) {
  var q = encodeURIComponent('site:' + site + ' "' + keyword + '"');
  var resp;
  try { resp = await engine.fetchText("https://cn.bing.com/search?q=" + q, "utf-8", 20000, 3); }
  catch (e) { return { links: 0, inserted: 0, error: e.message }; }
  if (resp.status !== 200) return { links: 0, inserted: 0, error: "http " + resp.status };
  var disk = site.indexOf("quark") >= 0 ? "quark" : "baidu";
  var re = /https?:\/\/pan\.(?:quark\.cn|baidu\.com)\/s\/[A-Za-z0-9_-]+/g;
  var links = [], m;
  while ((m = re.exec(resp.text)) && links.length < 8) {
    var u = m[0].replace(/&amp;/g, "&");
    if (links.indexOf(u) < 0) links.push(u);
  }
  var inserted = 0;
  for (var i = 0; i < links.length; i++) {
    try {
      var dup = await store.resourceExists(links[i]);
      if (dup) continue;
      await store.resourceAdd({ title: keyword, url: links[i], disk_type: disk, category: "综合", description: "site 采集：" + keyword, source: "collected", status: 1 });
      inserted++;
    } catch (e) {}
  }
  return { links: links.length, inserted: inserted };
}

// 主入口
async function run(config, task) {
  var startedAt = Date.now();
  config = config || {};
  var dailyLimit = parseInt(config.daily_limit, 10) || 200;
  var sh = parseInt(config.seedhub_limit, 10);
  var seedhubLimit = (isNaN(sh) || sh < 0) ? 30 : sh; // 0 = 本轮跳过 SeedHub
  var intervalMs = parseInt(config.interval_ms, 10) || 2000;
  var log = [];

  // ① 词库同步
  var kwReport = await syncKeywords();
  log.push("词库同步: 豆瓣+" + kwReport.douban + " 预置+" + kwReport.preset + " 热词+" + kwReport.hotword);

  // ② 取今日额度词
  var words = await mysql.keywordCrawlerTake(dailyLimit);
  log.push("取词 " + words.length + " 个（额度 " + dailyLimit + "）");

  // ③ 采集：盘搜源通道为主力（pansou 聚合，稳定），Bing site 通道默认关闭（config.enable_site_bing=1 开启作对比）
  var collectReport = { links: 0, inserted: 0, dup: 0, errors: 0, keywords: 0 };
  var enableBing = config.enable_site_bing ? true : false;
  var crawledIds = [];
  for (var i = 0; i < words.length; i++) {
    var kw = words[i];
    if (!kw.keyword) continue;
    var rp = await collectPansou(kw.keyword);
    collectReport.links += rp.links; collectReport.inserted += rp.inserted; collectReport.dup += rp.dup;
    if (rp.error) collectReport.errors++;
    if (enableBing) {
      var rq = await collectSite(kw.keyword, "pan.quark.cn");
      collectReport.links += rq.links; collectReport.inserted += rq.inserted;
      if (rq.error) collectReport.errors++;
      var rb = await collectSite(kw.keyword, "pan.baidu.com");
      collectReport.links += rb.links; collectReport.inserted += rb.inserted;
      if (rb.error) collectReport.errors++;
    }
    crawledIds.push(kw.id);
    await sleep(intervalMs); // 限流
  }
  await mysql.keywordCrawlerMarkCrawled(crawledIds);
  log.push("盘搜采集: " + words.length + " 词 → 链接 " + collectReport.links + "，新增 " + collectReport.inserted + "，去重 " + collectReport.dup + (collectReport.errors ? "，错误 " + collectReport.errors : "") + (enableBing ? "（含 Bing）" : ""));

  // ④ SeedHub 豆瓣资料增量同步（限量；seedhub_limit=0 跳过）
  var seedReport = { inserted: 0, updated: 0, matched: 0, errors: 0 };
  if (seedhubLimit > 0) {
    try {
      seedReport = await seedhub.crawlNew(seedhubLimit, 2);
      log.push("豆瓣资料: 新增 " + seedReport.inserted + "，更新 " + seedReport.updated + "，关联资源 " + seedReport.matched + (seedReport.errors ? "，错误 " + seedReport.errors : ""));
    } catch (e) { log.push("豆瓣资料: 失败 " + e.message); }
  } else {
    log.push("豆瓣资料: 跳过（seedhub_limit=0）");
  }

  // 执行成功即 ok（产出 0 由 resultMsg 说明，避免任务中心误判失败）
  return {
    status: "ok",
    resultMsg: log.join(" ｜ "),
    durationMs: Date.now() - startedAt,
  };
}

module.exports = { run, syncKeywords, collectPansou, collectSite, cleanHotword, PRESET_KEYWORDS };
