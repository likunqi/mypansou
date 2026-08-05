// server/handlers/tg.js — TG 频道采集（主力）管理
// 全局设置（RSSHub 实例/limit/间隔）+ 批量添加频道（自动套 TG 通用规则模板）+ TG 源列表
// + 采集网盘管理 + 实例测速 + AI 自动生成（规则+任务）
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const engine = require("../../lib/crawler-engine");
const ai = require("./ai");
const crypto = require("crypto");

// TG 通用解析规则模板（全频道通用，已用 okpojie 真实 XML 实测）
// url 只匹配夸克/百度盘链接（用户主力盘）；将来要接阿里影视频道时扩展 alipan/aliyun
const TG_RULES = [
  { field_name: "title", rule_type: "regex", rule_value: "<title>(.*?)</title>", required: true },
  { field_name: "url", rule_type: "regex", rule_value: "https://pan\\.(?:quark\\.cn|baidu\\.com)/s/[A-Za-z0-9_-]+", required: true },
  { field_name: "disk_type", rule_type: "regex", rule_value: "https://pan\\.(quark|baidu)\\.", required: false },
  { field_name: "description", rule_type: "regex", rule_value: "<description>(.*?)</description>", required: false },
  // 封面图：按优先级提取 enclosure（RSSHub TG 源常见）→ img → media:thumbnail；引擎取第一个非空捕获组
  { field_name: "thumbnail", rule_type: "regex", rule_value: "<(?:enclosure|media:thumbnail)[^>]*?url=\"([^\"]+\\.(?:jpe?g|png|webp|gif|avif|bmp))\"|<img[^>]+src=\"([^\"]+\\.(?:jpe?g|png|webp|gif|avif|bmp))\"", required: false },
];

const DEFAULT_INSTANCES = [
  { name: "woodland.cafe", host: "https://rsshub.woodland.cafe", enabled: true },
  { name: "ktachibana.party", host: "https://rsshub.ktachibana.party", enabled: true },
];

// 频道名 → 默认名称/分类（已知频道映射，未知频道用频道名兜底）
const CH_NAME = {
  okpojie: "okpojie TG 综合", softwareGods: "okpojie TG 软件", happyflims: "okpojie TG 影视",
  allgamegod: "okpojie TG 游戏", freekecheng: "okpojie TG 课程", ShortDramaGod: "okpojie TG 短剧",
  allgirlhunter: "okpojie TG 美女", Aliyun_4K_Movies: "4K影视 TG", netdisk_movies: "海外影视 TG",
  bdyunpan: "百度资源 TG", BaiduCloudDisk: "百度中转 TG",
  yunpan139: "移动云盘 TG", yunpan189: "天翼云盘 TG", yp123pan: "123云盘 TG",
  yunpanuc: "UC云盘 TG", yunpanxunlei: "迅雷云盘 TG", yunpans: "夸克综合 TG",
};

function readSettings(cfg) {
  var raw = cfg && cfg.tg_settings;
  if (typeof raw === "string") { try { return JSON.parse(raw) || {}; } catch (e) { return {}; } }
  return raw && typeof raw === "object" ? raw : {};
}
function normalizeSettings(s) {
  s = s || {};
  var instances = Array.isArray(s.instances) && s.instances.length ? s.instances : DEFAULT_INSTANCES;
  var def = s.default_instance || (instances[0] && instances[0].host) || "https://rsshub.woodland.cafe";
  return {
    instances: instances,
    default_instance: def,
    limit: parseInt(s.limit, 10) || 50,
    interval_sec: parseInt(s.interval_sec, 10) || 3600,
  };
}

async function getSettings(req, res) {
  try {
    var cfg = await store.getConfig();
    json(res, 200, normalizeSettings(readSettings(cfg)));
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function saveSettings(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var s = normalizeSettings(b);
    await store.saveConfig({ tg_settings: JSON.stringify(s) });
    json(res, 200, { ok: true, settings: s });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 批量添加频道：channels 数组或换行分隔字符串（可带 @ 或不带）→ 建源 + 套规则模板，幂等（同频道跳过）
async function batchAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var channels = (Array.isArray(b.channels) ? b.channels : String(b.channels || "").split(/[\n,]/))
      .map(function (c) { return String(c).trim().replace(/^@/, ""); })
      .filter(Boolean);
    if (!channels.length) return json(res, 400, { error: "channels 必填" });
    var cfg = await store.getConfig();
    var settings = normalizeSettings(readSettings(cfg));
    var instance = String(b.instance || settings.default_instance || "").trim();
    if (instance && !/^https?:\/\//i.test(instance)) instance = "https://" + instance;
    instance = instance.replace(/\/+$/, "");
    var limit = parseInt(b.limit, 10) || settings.limit || 50;
    var category = String(b.category || "").trim();
    var list = await store.crawlerSourceList(false);
    var created = [], existed = [], failed = [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      if (!/^[A-Za-z0-9_]{3,64}$/.test(ch)) { failed.push({ channel: ch, error: "频道名格式非法（字母数字下划线）" }); continue; }
      var dup = list.find(function (s) {
        var m = String(s.url_template).match(/\/telegram\/channel\/([A-Za-z0-9_]+)/);
        return m && m[1].toLowerCase() === ch.toLowerCase();
      });
      if (dup) { existed.push({ id: dup.id, channel: ch, name: dup.name }); continue; }
      var url = instance + "/telegram/channel/" + ch + "?limit=" + limit;
      var name = CH_NAME[ch] || (ch + " TG");
      var id = await store.crawlerSourceAdd({
        name: name,
        description: "Telegram 频道 @" + ch,
        source_type: "rss",
        url_template: url,
        page_start: 1, page_end: 1, encoding: "utf-8",
        category: category || "",
        disk_type: "",
        status: 1,
      });
      for (var r = 0; r < TG_RULES.length; r++) {
        await store.crawlerRuleAdd({
          source_id: id,
          field_name: TG_RULES[r].field_name,
          rule_type: TG_RULES[r].rule_type,
          rule_value: TG_RULES[r].rule_value,
          required: TG_RULES[r].required,
          default_value: "", filter_regex: "", position: r,
        });
      }
      created.push({ id: id, channel: ch, name: name });
    }
    json(res, 200, { ok: true, created: created, existed: existed, failed: failed });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// TG 源列表（含入库数聚合）
async function sourceList(req, res) {
  try {
    var list = await store.crawlerSourceList(false);
    var items = list.filter(function (s) { return String(s.url_template).indexOf("/telegram/channel/") > -1; });
    var counts = await store.resourceCountBySource();
    var out = items.map(function (s) {
      var m = String(s.url_template).match(/\/telegram\/channel\/([A-Za-z0-9_]+)/);
      return {
        id: s.id, channel: m ? m[1] : "", name: s.name, url_template: s.url_template,
        source_type: s.source_type, category: s.category, status: s.status,
        disk_type: s.disk_type, last_crawled_at: s.last_crawled_at,
        count: counts[String(s.id)] || 0,
      };
    });
    out.sort(function (a, b) { return a.id - b.id; });
    json(res, 200, { items: out });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 采集网盘管理 ----------
// site_config.tg_disks = ["quark","baidu",...]（勾选要采集的网盘；空数组 = 全部）
const DISK_OPTIONS = [
  { id: "quark", name: "夸克" }, { id: "baidu", name: "百度" }, { id: "aliyun", name: "阿里" },
  { id: "tianyi", name: "天翼" }, { id: "uc", name: "UC" }, { id: "xunlei", name: "迅雷" },
];
const DISK_HOST = {
  quark: "quark\\.cn", baidu: "baidu\\.com", aliyun: "alipan\\.com|aliyundrive\\.com",
  tianyi: "cloud\\.189\\.cn", uc: "uc\\.cn|drive\\.uc\\.cn", xunlei: "xunlei\\.com|pan\\.xunlei\\.com",
};
function readDisks(cfg) {
  var raw = cfg && cfg.tg_disks;
  if (typeof raw === "string") { try { return JSON.parse(raw) || []; } catch (e) { return []; } }
  return Array.isArray(raw) ? raw : [];
}
async function getDisks(req, res) {
  try {
    var cfg = await store.getConfig();
    json(res, 200, { options: DISK_OPTIONS, selected: readDisks(cfg) });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function saveDisks(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var selected = (Array.isArray(b.selected) ? b.selected : []).filter(function (d) {
      return DISK_OPTIONS.some(function (o) { return o.id === d; });
    });
    await store.saveConfig({ tg_disks: JSON.stringify(selected) });
    json(res, 200, { ok: true, selected: selected });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- RSSHub 实例测速 ----------
async function testInstances(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = await store.getConfig();
    var settings = normalizeSettings(readSettings(cfg));
    var hosts = Array.isArray(b.hosts) && b.hosts.length ? b.hosts : settings.instances.map(function (i) { return i.host; });
    var out = [];
    for (var i = 0; i < hosts.length; i++) {
      var h = String(hosts[i] || "").trim().replace(/\/+$/, "");
      if (!h) continue;
      var t0 = Date.now();
      var ok = false, err = "";
      try {
        var r = await engine.fetchText(h + "/telegram/channel/okpojie?limit=1", "utf-8", 8000);
        ok = r.status === 200;
        if (!ok) err = "HTTP " + r.status;
      } catch (e) { err = e.message; }
      out.push({ host: h, ok: ok, ms: Date.now() - t0, error: err });
    }
    json(res, 200, { results: out });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- AI 自动生成：规则 + 采集源 + 任务 一键 ----------
// 流程：拉频道 RSS 原文 → 取示例条目 → AI（内置领域提示词）生成规则 → validateRules 校验
//       → 建/更新采集源 → 套规则（ruleReplace）→ 建 crawl_source 任务（幂等）
async function aiGenerate(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var channel = String(b.channel || "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,64}$/.test(channel)) { json(res, 400, { error: "频道名格式非法" }); return; }

    var cfg = await store.getConfig();
    var settings = normalizeSettings(readSettings(cfg));
    var instance = String(b.instance || settings.default_instance || "").trim();
    if (instance && !/^https?:\/\//i.test(instance)) instance = "https://" + instance;
    instance = instance.replace(/\/+$/, "");
    if (!instance) { json(res, 400, { error: "未配置 RSSHub 实例" }); return; }
    var limit = parseInt(b.limit, 10) || settings.limit || 50;
    var disks = Array.isArray(b.disks) ? b.disks : readDisks(cfg);
    var catMap = readCatMap(cfg);
    var category = String(b.category || "").trim() || catMap[channel] || CH_CAT[channel] || "";

    // 1) 拉频道 RSS 原文（多实例故障切换：429/5xx/超时自动换下一个）
    var url = "";
    var instancesPool = Array.isArray(settings.instances) && settings.instances.length
      ? settings.instances.map(function (i) { return i.host; }).filter(Boolean)
      : [settings.default_instance].filter(Boolean);
    // 请求指定实例优先，失败再切池内其他
    if (instance && instancesPool.indexOf(instance) < 0) instancesPool.unshift(instance);
    var resp = null, lastErr = "";
    for (var tgi = 0; tgi < instancesPool.length; tgi++) {
      var tryHost = String(instancesPool[tgi] || "").replace(/\/+$/, "");
      if (!tryHost) continue;
      var tryUrl = tryHost + "/telegram/channel/" + channel + "?limit=" + limit;
      try {
        var rr = await engine.fetchText(tryUrl, "utf-8", 20000);
        if (rr.status === 200) { resp = rr; url = tryUrl; break; }
        lastErr = "HTTP " + rr.status + " (" + tryHost + ")";
        if (rr.status === 429) await new Promise(function (r2) { setTimeout(r2, 1500); }); // 429 限流缓冲
      } catch (e) { lastErr = e.message + " (" + tryHost + ")"; }
    }
    if (!resp) { json(res, 502, { ok: false, error: "所有实例抓取频道失败: " + lastErr }); return; }
    var xml = resp.text || "";

    // 2) 取前 2 条完整 item 作为 AI 示例（CDATA 展开）
    var sampleItems = [];
    var re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi, m;
    while ((m = re.exec(xml)) && sampleItems.length < 2) {
      sampleItems.push(m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").slice(0, 800));
    }
    var sampleText = sampleItems.join("\n\n----\n\n") || "(频道暂无内容)";

    // 3) AI 生成规则（内置领域提示词 + TG 上下文 + 网盘约束）
    var ac = await ai.getAiConfig();
    var diskNames = disks.length ? disks.map(function (d) {
      var o = DISK_OPTIONS.find(function (x) { return x.id === d; });
      return o ? o.name + "(" + d + ")" : d;
    }).join("/") : "全部（不限网盘）";
    var diskRegex = disks.length
      ? "^https:\\/\\/pan\\.(?:" + disks.map(function (d) { return DISK_HOST[d]; }).filter(Boolean).join("|") + ")\\/s\\/[A-Za-z0-9_-]+"
      : "^https:\\/\\/pan\\.(?:quark\\.cn|baidu\\.com)\\/s\\/[A-Za-z0-9_-]+";
    var sys = await ai.getEffectivePrompt("tg_collect");
    var prompt = "目标采集源: Telegram 频道 @" + channel + "\nRSS URL: " + url +
      "\n采集网盘限制: " + diskNames + "\n分类: " + (category || "(未设置)") +
      "\nurl 字段必须匹配的网盘正则参考: " + diskRegex +
      "\n\n频道 RSS 示例内容（前 2 条）:\n" + sampleText +
      "\n\n请为该频道生成解析规则 JSON 数组（title/url 必填，url 用上面网盘正则匹配）。";
    var out = await ai.chat(ac, prompt.slice(0, 14000), sys);
    var arr = ai.extractJsonArray(out);
    if (!arr || !arr.length) { json(res, 502, { ok: false, error: "AI 未能生成规则（" + out.slice(0, 80) + "…）" }); return; }
    var report = ai.validateRules(arr);
    if (!report.rules.length) { json(res, 502, { ok: false, error: "AI 规则全部被领域约束拦截" }); return; }

    // 4) 建/更新采集源（幂等：同频道已有源则更新，否则新建）
    var list = await store.crawlerSourceList(false);
    var dup = list.find(function (s) {
      var mm = String(s.url_template).match(/\/telegram\/channel\/([A-Za-z0-9_]+)/);
      return mm && mm[1].toLowerCase() === channel.toLowerCase();
    });
    var sourceId;
    var name = CH_NAME[channel] || (channel + " TG");
    if (dup) {
      sourceId = dup.id;
      await store.crawlerSourceUpdate(dup.id, {
        url_template: url, category: category, disk_type: disks[0] || "",
        description: "Telegram 频道 @" + channel + "（AI 生成）",
      });
    } else {
      sourceId = await store.crawlerSourceAdd({
        name: name, description: "Telegram 频道 @" + channel + "（AI 生成）",
        source_type: "rss", url_template: url, page_start: 1, page_end: 1,
        encoding: "utf-8", category: category, disk_type: disks[0] || "", status: 1,
      });
    }

    // 5) 套规则（清旧插新）
    var oldRules = await store.crawlerRuleList(sourceId);
    for (var k = 0; k < oldRules.length; k++) await store.crawlerRuleDelete(oldRules[k].id);
    for (var j = 0; j < report.rules.length; j++) {
      var r = report.rules[j];
      await store.crawlerRuleAdd({
        source_id: sourceId, field_name: r.field_name, rule_type: r.rule_type,
        rule_value: r.rule_value, required: r.required === true,
        default_value: r.default_value || "", filter_regex: r.filter_regex || "", position: j,
      });
    }

    // 6) 建 crawl_source 任务（幂等：同源已有启用任务则跳过）
    var taskRows = await mysql.taskList();
    var existingTask = (taskRows || []).find(function (t) {
      var c = t.task_config;
      var cc = (typeof c === "string" ? JSON.parse(c) : c) || {};
      return t.task_type === "crawl_source" && String(cc.source_id) === String(sourceId);
    });
    var taskId = existingTask ? existingTask.id : null;
    if (!taskId) {
      taskId = await mysql.taskAdd({
        task_name: "采集 " + channel + "（AI 生成）", task_type: "crawl_source",
        interval_sec: settings.interval_sec || 3600,
        task_config: { source_id: sourceId }, status: 1,
      });
    }

    json(res, 200, {
      ok: true,
      source_id: sourceId,
      task_id: taskId,
      name: name,
      channel: channel,
      rules_count: report.rules.length,
      rejected: report.rejected,
      fixed: report.fixed,
      report: report,
      url: url,
    });
  } catch (e) {
    console.error("[tg] aiGenerate:", e.stack || e.message);
    json(res, 502, { ok: false, error: e.message });
  }
}

module.exports = { getSettings, saveSettings, batchAdd, sourceList, getDisks, saveDisks, testInstances, aiGenerate };
