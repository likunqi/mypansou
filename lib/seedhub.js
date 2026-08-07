// lib/seedhub.js — SeedHub 影视&动漫资料采集（8-07）
// 依据：seeduck.cc robots.txt `Content-Signal: search=yes, use=reference`（允许搜索索引用途，禁止 AI 训练）
// 只爬公开列表页/详情页（服务端渲染，正则可解析）；不爬 /s/ 与 /link_start/（robots Disallow，磁力对我们无用）
// 流程：列表页 → 详情页 → douban_subjects upsert → 资源标题匹配关联 resources.douban_id
const engine = require("./crawler-engine");
const douban = require("./douban");
const mysql = require("./mysql");

const BASE = "https://seeduck.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// HTML → 纯文本（保留换行，供字段行解析）
function toText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

// 列表页 → 条目摘要 [{seed_id, title, original_title, poster, year, media_type, rating, douban_id}]
// SeedHub 首页条目块：<div class="cover"><a ... title="中文名 原名" href="/movies/135386/"><img src="海报"></a><ul><li><h2>... 中文名</h2></li><li>2026 / 电影 / 地区 / 语言 / 演员</li><li>类型: ...</li><li>豆瓣评分: <a href="...subject/123/">7.1</a></li>...
function parseListPage(html) {
  var out = [];
  var blocks = String(html || "").split('<div class="cover">').slice(1);
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var m = b.match(/title="([^"]*)"[^>]*class="image"[^>]*href="\/movies\/(\d+)\/"/);
    if (!m) continue;
    var fullTitle = m[1] || "";
    var h2 = b.match(/<h2[^>]*>[\s\S]*?<\/a>\s*([^<]+)<\/h2>/);
    var cnTitle = h2 ? h2[1].trim() : "";
    var sp = String(fullTitle).split(/\s+/);
    var title = cnTitle || sp[0] || "";
    // 原名：title 属性去掉中文名后的剩余部分（如 "寒战1994 寒戰1994" → 寒戰1994）；纯中文含空格则不给原名
    var original = "";
    if (cnTitle) { original = String(fullTitle).replace(cnTitle, "").trim(); }
    else if (sp.length > 1) { original = sp.slice(1).join(" "); }
    var d = b.match(/movie\.douban\.com\/subject\/(\d+)\//);
    var r = b.match(/豆瓣评分[:：]?\s*<a[^>]*>\s*([\d.]+)\s*<\/a>/);
    var y = b.match(/<li>\s*(\d{4})\s*\/\s*(电影|剧集|动漫|综艺|纪录片|电视剧|短片|图书)[^<]*<\/li>/);
    var img = b.match(/<img[^>]+src="([^"]+)"/);
    var MT = { 电影: "movie", 剧集: "tv", 电视剧: "tv", 动漫: "anime", 综艺: "variety", 纪录片: "doc", 短片: "short", 图书: "book" };
    out.push({
      seed_id: parseInt(m[2], 10),
      title: String(title).trim().slice(0, 255),
      original_title: String(original).trim().slice(0, 255),
      poster: img ? img[1] : "",
      year: y ? parseInt(y[1], 10) : 0,
      media_type: y ? (MT[y[2]] || "") : "",
      rating: r ? parseFloat(r[1]) : 0,
      douban_id: d ? parseInt(d[1], 10) : 0,
    });
  }
  return out;
}

// 详情页字段行提取（"导演: xxx / yyy"）；label 支持 "制片国家/地区|制片国家" 交替，先分组避免优先级问题
function grabField(text, label) {
  var re = new RegExp("(?:^|\\n)\\s*(?:" + label + ")[:：]\\s*([^\\n]{0,500})", "i");
  var m = text.match(re);
  if (!m || m[1] === undefined) return "";
  return m[1].replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim().slice(0, 500);
}

// 详情页 → 全字段（基于列表摘要 e）
async function fetchDetail(e) {
  var resp = await engine.fetchText(BASE + "/movies/" + e.seed_id + "/", "utf-8", 20000, 3);
  if (resp.status !== 200) throw new Error("detail http " + resp.status);
  var html = resp.text;
  var text = toText(html);
  var rec = {
    douban_id: e.douban_id || 0,
    seed_id: e.seed_id,
    seed_url: BASE + "/movies/" + e.seed_id + "/",
    title: e.title,
    original_title: e.original_title || "",
    year: e.year || 0,
    media_type: e.media_type || "",
    rating: e.rating || 0,
    region: grabField(text, "制片国家/地区|制片国家|国家/地区"),
    languages: grabField(text, "语言"),
    directors: grabField(text, "导演"),
    writers: grabField(text, "编剧"),
    actors: grabField(text, "主演"),
    genres: grabField(text, "类型"),
    release_date: grabField(text, "首播|上映"),
    duration: grabField(text, "单集片长|片长"),
    summary: "",
    poster: e.poster || "",
    douban_url: e.douban_id ? "https://movie.douban.com/subject/" + e.douban_id + "/" : "",
    source: "seeduck",
  };
  var ep = text.match(/(?:^|\n)\s*集数[:：]\s*(\d+)/i);
  rec.episodes = ep ? parseInt(ep[1], 10) : 0;
  // 简介：「xxx的简介」段落
  var sm = text.match(/的简介\s*\n([\s\S]*?)(?=\n\s*##|\n[^\n]*的图片|$)/i);
  if (sm) rec.summary = sm[1].replace(/\s+/g, " ").trim().slice(0, 3000);
  // 海报兜底（详情页图片区 img/src 或 og:image）
  if (!rec.poster) {
    var pm = html.match(/(?:src|data-src)="(https?:\/\/[^"]*(?:poster|cover|pic)[^"]*)"/i) ||
             html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (pm) rec.poster = pm[1];
  }
  return rec;
}

// 豆瓣移动版补海报（og:image）+ 简介（meta description，兜底 SeedHub 缺失时）
async function enrichDouban(rec) {
  if (!rec.douban_id) return rec;
  try {
    if (!rec.poster) {
      var r = await engine.fetchText("https://m.douban.com/movie/subject/" + rec.douban_id + "/", "utf-8", 15000, 2);
      if (r.status === 200) {
        var pm = r.text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        if (pm) rec.poster = pm[1];
        if (!rec.summary) {
          var sm = r.text.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
          if (sm) {
            var txt = sm[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
            var idx = txt.indexOf("简介：");
            if (idx >= 0) rec.summary = txt.slice(idx + 3).trim().slice(0, 3000);
          }
        }
      }
    }
  } catch (e) { /* 豆瓣补全失败不影响入库 */ }
  return rec;
}

// 增量采集：列表页（首页+分页）→ 详情页 → upsert → 标题匹配资源
// limit: 本次最多新增+更新多少条目（<=0 跳过）；pageCount: 列表页翻几页
async function crawlNew(limit, pageCount) {
  var lim = parseInt(limit, 10);
  if (isNaN(lim) || lim <= 0) return { inserted: 0, updated: 0, skipped: 0, errors: 0, matched: 0 };
  limit = lim;
  pageCount = Math.min(Math.max(parseInt(pageCount, 10) || 1, 1), 10);
  var inserted = 0, updated = 0, skipped = 0, errors = 0;
  var seen = {};
  for (var p = 1; p <= pageCount; p++) {
    if (inserted + updated >= limit) break;
    // 列表入口为首页（最近更新排序便于增量），分页 ?page=N
    var listUrl = BASE + "/?order=update" + (p > 1 ? "&page=" + p : "");
    var resp = await engine.fetchText(listUrl, "utf-8", 20000, 3);
    if (resp.status !== 200) { errors++; await sleep(1500); continue; }
    var entries = parseListPage(resp.text);
    for (var i = 0; i < entries.length; i++) {
      if (inserted + updated >= limit) break;
      var e = entries[i];
      if (seen[e.seed_id]) continue;
      seen[e.seed_id] = 1;
      try {
        var rec = await fetchDetail(e);
        rec = await enrichDouban(rec);
        var before = await mysql.doubanGetByDoubanId(rec.douban_id, rec.seed_id);
        await mysql.doubanUpsert(rec);
        if (before) updated++; else inserted++;
      } catch (ex) { skipped++; }
      await sleep(1000); // 详情页限速
    }
    await sleep(1500); // 列表页限速
  }
  var match = await mysql.doubanLinkResources(500);
  return { inserted: inserted, updated: updated, skipped: skipped, errors: errors, matched: match.matched };
}

module.exports = { parseListPage, crawlNew, fetchDetail, toText };
