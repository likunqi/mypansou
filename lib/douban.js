// lib/douban.js — 豆瓣搜索 + 剧情简介（免 key，资源描述补全用）
//  - search(title): 调 movie.douban.com/j/subject_suggest 拿候选（id/标题/年份/海报）
//  - summary(id): 调 m.douban.com/movie/subject/<id>/（移动版 200 不反爬）解析 meta description 的「简介：」内容
//  - enrich(title): 组合流程：搜索→命中→简介；返回 {ok, source:"douban", title, year, summary, img}
const { fetchHttps } = require("../server/middleware");

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

// 豆瓣搜索（免 key）：返回 [{id,title,year,img,type}]，按 title 近似匹配优先
async function search(title) {
  var q = String(title || "").trim();
  if (!q) return [];
  // 清洗标题：去掉网盘资源标题常见的冗余（分辨率/集数/年份/来源等），只留作品名核心词
  var clean = q
    .replace(/[【\[(（].*?[】\])）]/g, " ")                // 去括号内容
    .replace(/S\d+E[\d\-]+/gi, " ")                       // 剧集标记 S01E01-E17
    .replace(/\bE\d+\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")                           // 孤立年份
    .replace(/\b(4K|HD|HDR|1080P|720P|2160P|REMUX|WEB-DL|蓝光|原盘|中字|国语|粤语|内嵌|特效|简中|繁中|60FPS|DTS|高码率|高码|无水印|修复版|双语|双字|完整版|典藏版|收藏版|合集|全\d+集|更新至\d+集|第.*季|第.*期|已完结|完结|番外|剧场版|加长版)\b/g, " ")
    .replace(/[\s_\-—·,，、:：]+/g, " ")
    .trim();
  if (!clean) return [];
  var words = clean.split(" ").filter(function (w) { return w.length >= 2; });
  // 取第一个有意义的词作为搜索词（跳过日期类），作品名通常在标题开头
  var q2 = "";
  for (var wi = 0; wi < words.length; wi++) {
    if (/\d+月\d+日/.test(words[wi])) continue;
    q2 = words[wi];
    break;
  }
  if (!q2 && words.length) q2 = words[0];
  if (!q2) return [];
  try {
    var r = await fetchHttps("https://movie.douban.com", "/j/subject_suggest?q=" + encodeURIComponent(q2), { "User-Agent": UA, "Referer": "https://movie.douban.com/" }, null);
    if (!r || r.status >= 400) return { error: "http_" + (r && r.status) };
    var j;
    try { j = JSON.parse(r.body); } catch (e) { return { error: "bad_json" }; } // 限流/风控常见返回非 JSON
    if (!Array.isArray(j)) return { error: "bad_payload" };
    return j.map(function (x) { return { id: String(x.id), title: x.title || "", year: x.year || "", img: x.img || "", type: x.type || "" }; });
  } catch (e) { return { error: e.message }; }
}

// 剧情简介（移动版页面 meta description）："《标题》豆瓣评分：X.X 简介：<内容>"
async function summary(id) {
  try {
    var r = await fetchHttps("https://m.douban.com", "/movie/subject/" + id + "/", { "User-Agent": UA }, null);
    var body = r.body || "";
    var m = body.match(/<meta\s+name="description"\s+content="([^"]*)"/);
    if (!m) return "";
    var txt = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // 取「简介：」之后的内容
    var idx = txt.indexOf("简介：");
    if (idx >= 0) txt = txt.slice(idx + 3);
    return txt.trim().slice(0, 500);
  } catch (e) { return ""; }
}

// 组合：标题 → 豆瓣简介（命中判定：返回标题与搜索词有公共词）
async function enrich(title) {
  try {
    var cands = await search(title);
    // 限流/网络错误：返回 error 标记（调用方应暂停豆瓣尝试，避免误判"无结果"）
    if (!Array.isArray(cands)) return { ok: false, reason: "douban_error", error: cands && cands.error };
    if (!cands.length) return { ok: false, reason: "no_douban_hit" };
    var cleanT = String(title || "").replace(/[【\[(（].*?[】\])）]/g, "").replace(/\s+/g, "").slice(0, 6);
    var hit = null;
    for (var i = 0; i < cands.length; i++) {
      var cT = String(cands[i].title || "").replace(/\s+/g, "");
      // 标题前 N 字匹配或包含关系
      if (cleanT && (cT.indexOf(cleanT) >= 0 || cleanT.indexOf(cT) >= 0 || cleanT.slice(0, 3) === cT.slice(0, 3))) { hit = cands[i]; break; }
    }
    if (!hit && cands.length) hit = cands[0]; // 无严格命中用第一个候选（评分可能低但通常同作品）
    if (!hit) return { ok: false, reason: "no_match" };
    var s = await summary(hit.id);
    if (!s) return { ok: false, reason: "no_summary", title: hit.title, year: hit.year, img: hit.img };
    return { ok: true, source: "douban", title: hit.title, year: hit.year, img: hit.img, summary: s };
  } catch (e) { return { ok: false, reason: "error", error: e.message }; }
}

module.exports = { search, summary, enrich };
