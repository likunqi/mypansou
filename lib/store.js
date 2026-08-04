// lib/store.js — 统一存储层：MySQL 优先 + JSON 镜像/兜底
// 所有业务读写都走这里：MySQL 可用时以 MySQL 为主存储，同时镜像写 JSON（降级可读）；
// MySQL 不可用时自动回落 JSON，保证服务不中断。
const fs = require("fs");
const path = require("path");
const { rd, wr, PATHS } = require("./storage");
const crypto = require("./crypto");
const mysql = require("./mysql");

const HISTORY_FILE = path.join(PATHS.DATA_DIR, "transfer_history.json");
const TRENDING_FILE = path.join(PATHS.DATA_DIR, "trending.json");
const RESOURCES_FILE = path.join(PATHS.DATA_DIR, "resources.json");
const SUBMISSIONS_FILE = path.join(PATHS.DATA_DIR, "submissions.json");
const CRAWLER_FILE = path.join(PATHS.DATA_DIR, "crawler.json");
const IMPORT_LOGS_FILE = path.join(PATHS.DATA_DIR, "import_logs.json");
const REPORTS_FILE = path.join(PATHS.DATA_DIR, "reports.json");
const KEYWORDS_FILE = path.join(PATHS.DATA_DIR, "keywords.json");
const AI_SUMMARIES_FILE = path.join(PATHS.DATA_DIR, "ai_summaries.json");

function safeRead(p, d) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } }

// ---------- site_config ----------
async function getConfig() {
  try {
    var all = await mysql.cfgGetAll();
    if (all && Object.keys(all).length) {
      var j = rd(PATHS.CFG, {});
      if (!all.encKey && j.encKey) all.encKey = j.encKey; // 迁移前兜底：encKey 以 JSON 为准
      return all;
    }
  } catch (e) {}
  return rd(PATHS.CFG, {});
}
async function saveConfig(obj) {
  var cfg = rd(PATHS.CFG, {});
  Object.assign(cfg, obj);
  wr(PATHS.CFG, cfg);
  try { await mysql.cfgSetAll(cfg); } catch (e) {}
}

// ---------- admin_users ----------
async function getAdmin() {
  try {
    var a = await mysql.adminGet();
    if (a && a.password_hash) return { password: a.password_hash, created: Date.now() };
  } catch (e) {}
  return rd(PATHS.ADMIN, { password: "" });
}
async function verifyAdmin(pw) {
  var a = await getAdmin();
  if (!a.password) return false;
  return crypto.verify(pw, a.password);
}
async function setAdminPassword(hashStr) {
  wr(PATHS.ADMIN, { password: hashStr, created: Date.now() });
  try { await mysql.adminSetHash(hashStr); } catch (e) {}
}

// ---------- cookies ----------
async function getCookiesObj() {
  try {
    var all = await mysql.cookieGetAll();
    if (all && Object.keys(all).length) return all;
  } catch (e) {}
  return safeRead(PATHS.COOKIES, {});
}
async function saveCookie(provider, encValue) {
  try { await mysql.cookieSet(provider, encValue, 0); } catch (e) {}
  var obj = safeRead(PATHS.COOKIES, {});
  obj[provider] = encValue;
  wr(PATHS.COOKIES, obj);
}

// ---------- transfer_cache ----------
async function cacheGet(url) {
  try {
    var r = await mysql.cacheGet(url);
    if (r) return r;
  } catch (e) {}
  var cd = rd(PATHS.CACHE, { links: {} });
  return cd.links[url] || null;
}
async function cacheSet(url, result) {
  try { await mysql.cacheSet(url, result.newUrl, result.pwd, result.note); } catch (e) {}
  var cd = rd(PATHS.CACHE, { links: {}, stats: { total: 0, quark: 0, baidu: 0 } });
  cd.links = cd.links || {};
  cd.links[url] = result;
  cd.stats = cd.stats || { total: 0, quark: 0, baidu: 0 };
  cd.stats.total = Object.keys(cd.links).length;
  wr(PATHS.CACHE, cd);
}
async function cacheStats() {
  try {
    var st = await mysql.cacheStats();
    if (st) return st;
  } catch (e) {}
  var cd = rd(PATHS.CACHE, { links: {}, stats: { total: 0, quark: 0, baidu: 0 } });
  return cd.stats || { total: Object.keys(cd.links || {}).length, quark: 0, baidu: 0 };
}
async function cacheClear() {
  try { await mysql.cacheClear(); } catch (e) {}
  wr(PATHS.CACHE, { links: {}, stats: { total: 0, quark: 0, baidu: 0 } });
}

// ---------- transfer_history ----------
async function historyAdd(rec) {
  try { await mysql.historyAdd(rec); } catch (e) {}
  var hist = safeRead(HISTORY_FILE, { records: [] });
  hist.records = hist.records || [];
  hist.records.unshift(rec);
  if (hist.records.length > 200) hist.records = hist.records.slice(0, 200);
  wr(HISTORY_FILE, hist);
}
async function historyList(limit) {
  try {
    var list = await mysql.historyList(limit);
    if (list && list.length) return list;
  } catch (e) {}
  var hist = safeRead(HISTORY_FILE, { records: [] });
  return (hist.records || []).slice(0, limit || 50);
}

// ---------- 热榜缓存（hot.js 独立文件，避免与转存缓存混用） ----------
function getTrendingCache() { return safeRead(TRENDING_FILE, {}); }
function saveTrendingCache(obj) { wr(TRENDING_FILE, obj); }

// ---------- resources（本地搜索核心数据源，MySQL 优先 + JSON 兜底） ----------
function resNextId(arr) {
  var m = 0;
  for (var i = 0; i < arr.length; i++) if (arr[i].id > m) m = arr[i].id;
  return m + 1;
}
async function resourceAdd(rec) {
  try {
    var id = await mysql.resourceAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var arr = safeRead(RESOURCES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  if (rec.id === null || rec.id === undefined) rec.id = resNextId(arr);
  arr.unshift(rec);
  wr(RESOURCES_FILE, arr);
  return rec.id;
}
async function resourceGet(id) {
  try {
    var r = await mysql.resourceGet(id);
    if (r) return r;
  } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(id)) return arr[i];
  return null;
}
async function resourceUpdate(id, fields) {
  try { await mysql.resourceUpdate(id, fields); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  for (var i = 0; i < arr.length; i++) {
    if (String(arr[i].id) === String(id)) { Object.assign(arr[i], fields); wr(RESOURCES_FILE, arr); return; }
  }
}
async function resourceDelete(id) {
  try { await mysql.resourceDelete(id); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  wr(RESOURCES_FILE, arr.filter(function (x) { return String(x.id) !== String(id); }));
}
async function resourceCount() {
  try { return await mysql.resourceCount(); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  return Array.isArray(arr) ? arr.length : 0;
}
async function resourceExists(url) {
  try { return await mysql.resourceExists(url); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  return (Array.isArray(arr) ? arr : []).some(function (x) { return String(x.url) === String(url); });
}
// 本地搜索：kw/category/diskType/source/status/page/size
async function resourceSearch(opt) {
  try {
    var r = await mysql.resourceSearch(opt);
    if (r && r.items) return r;
  } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  var kw = (opt.kw || "").toLowerCase();
  var list = arr.filter(function (x) {
    if (opt.category && x.category !== opt.category) return false;
    if (opt.diskType && x.disk_type !== opt.diskType) return false;
    if (opt.source && x.source !== opt.source) return false;
    if (opt.status !== undefined && opt.status !== null && opt.status !== "" && String(x.status) !== String(opt.status)) return false;
    if (kw) {
      var hay = ((x.title || "") + " " + (x.description || "") + " " + (x.category || "")).toLowerCase();
      if (hay.indexOf(kw) === -1) return false;
    }
    return true;
  });
  list.sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });
  var page = Math.max(parseInt(opt.page || "1", 10), 1);
  var size = Math.min(Math.max(parseInt(opt.size || "20", 10), 1), 100);
  return { total: list.length, page: page, size: size, items: list.slice((page - 1) * size, page * size) };
}

// ---------- submitted_resources（提交审核） ----------
async function submitAdd(rec) {
  try {
    var id = await mysql.submitAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var arr = safeRead(SUBMISSIONS_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  rec.id = rec.id || resNextId(arr);
  rec.status = 0;
  rec.created_at = rec.created_at || new Date().toISOString().slice(0, 19).replace("T", " ");
  arr.unshift(rec);
  wr(SUBMISSIONS_FILE, arr);
  return rec.id;
}
async function submitList(status, page, size) {
  try {
    var r = await mysql.submitList(status, page, size);
    if (r && r.items) return r;
  } catch (e) {}
  var arr = safeRead(SUBMISSIONS_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  var list = status === undefined || status === null || status === "" ? arr : arr.filter(function (x) { return String(x.status) === String(status); });
  list = list.slice().sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });
  page = Math.max(parseInt(page || "1", 10), 1);
  size = Math.min(Math.max(parseInt(size || "20", 10), 1), 100);
  return { total: list.length, page: page, size: size, items: list.slice((page - 1) * size, page * size) };
}
async function submitReview(id, status, adminRemark, resourceId) {
  try { await mysql.submitReview(id, status, adminRemark, resourceId); } catch (e) {}
  var arr = safeRead(SUBMISSIONS_FILE, []);
  for (var i = 0; i < arr.length; i++) {
    if (String(arr[i].id) === String(id)) {
      arr[i].status = status; arr[i].admin_remark = adminRemark || ""; arr[i].resource_id = resourceId || null;
      arr[i].reviewed_at = new Date().toISOString().slice(0, 19).replace("T", " ");
      wr(SUBMISSIONS_FILE, arr);
      return;
    }
  }
}

// ---------- crawler（采集源 + 规则） ----------
function crawlerJson() { return safeRead(CRAWLER_FILE, { sources: [], rules: [] }); }
async function crawlerSourceList(onlyActive) {
  try {
    var rows = await mysql.crawlerSourceList(onlyActive);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var d = crawlerJson();
  return onlyActive ? d.sources.filter(function (s) { return String(s.status) === "1"; }) : d.sources;
}
async function crawlerSourceAdd(rec) {
  try {
    var id = await mysql.crawlerSourceAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var d = crawlerJson();
  rec.id = rec.id || resNextId(d.sources);
  d.sources.unshift(rec);
  wr(CRAWLER_FILE, d);
  return rec.id;
}
async function crawlerSourceUpdate(id, fields) {
  try { await mysql.crawlerSourceUpdate(id, fields); } catch (e) {}
  var d = crawlerJson();
  for (var i = 0; i < d.sources.length; i++) {
    if (String(d.sources[i].id) === String(id)) { Object.assign(d.sources[i], fields); wr(CRAWLER_FILE, d); return; }
  }
}
async function crawlerSourceDelete(id) {
  try { await mysql.crawlerSourceDelete(id); } catch (e) {}
  var d = crawlerJson();
  d.sources = d.sources.filter(function (s) { return String(s.id) !== String(id); });
  d.rules = d.rules.filter(function (r) { return String(r.source_id) !== String(id); });
  wr(CRAWLER_FILE, d);
}
async function crawlerRuleList(sourceId) {
  try {
    var rows = await mysql.crawlerRuleList(sourceId);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var d = crawlerJson();
  return sourceId ? d.rules.filter(function (r) { return String(r.source_id) === String(sourceId); }) : d.rules;
}
async function crawlerRuleAdd(rec) {
  try {
    var id = await mysql.crawlerRuleAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var d = crawlerJson();
  rec.id = rec.id || resNextId(d.rules);
  d.rules.push(rec);
  wr(CRAWLER_FILE, d);
  return rec.id;
}
async function crawlerRuleUpdate(id, fields) {
  try { await mysql.crawlerRuleUpdate(id, fields); } catch (e) {}
  var d = crawlerJson();
  for (var i = 0; i < d.rules.length; i++) {
    if (String(d.rules[i].id) === String(id)) { Object.assign(d.rules[i], fields); wr(CRAWLER_FILE, d); return; }
  }
}
async function crawlerRuleDelete(id) {
  try { await mysql.crawlerRuleDelete(id); } catch (e) {}
  var d = crawlerJson();
  d.rules = d.rules.filter(function (r) { return String(r.id) !== String(id); });
  wr(CRAWLER_FILE, d);
}

// ---------- import_logs ----------
async function importLogAdd(rec) {
  try {
    var id = await mysql.importLogAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var arr = safeRead(IMPORT_LOGS_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  rec.id = rec.id || resNextId(arr);
  arr.unshift(rec);
  if (arr.length > 200) arr = arr.slice(0, 200);
  wr(IMPORT_LOGS_FILE, arr);
  return rec.id;
}
async function importLogList(limit) {
  try {
    var rows = await mysql.importLogList(limit);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var arr = safeRead(IMPORT_LOGS_FILE, []);
  return (Array.isArray(arr) ? arr : []).slice(0, limit || 50);
}

// ---------- broken_link_reports（失效反馈） ----------
async function reportAdd(rec) {
  try { return await mysql.reportAdd(rec); } catch (e) {}
  var arr = safeRead(REPORTS_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  rec.id = resNextId(arr);
  rec.created_at = rec.created_at || new Date().toISOString().slice(0, 19).replace("T", " ");
  arr.unshift(rec);
  wr(REPORTS_FILE, arr);
  return rec.id;
}
async function reportList(limit) {
  try {
    var rows = await mysql.reportList(limit);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var arr = safeRead(REPORTS_FILE, []);
  return (Array.isArray(arr) ? arr : []).slice(0, limit || 50);
}

// ---------- search_keywords（热搜关键词：采集 + 手动维护） ----------
async function keywordRecord(kw) {
  try { await mysql.keywordUpsert(kw); } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items;
  if (!Array.isArray(arr)) arr = [];
  var hit = arr.find(function (x) { return String(x.keyword) === String(kw); });
  if (hit) hit.search_count = (hit.search_count || 0) + 1;
  else arr.push({ keyword: kw, search_count: 1, is_hot: 0, sort_order: 0, status: 1, source: "" });
  arr.sort(function (a, b) { return (b.search_count || 0) - (a.search_count || 0); });
  wr(KEYWORDS_FILE, { items: arr.slice(0, 200) });
}
async function keywordCollect(kw, source) {
  try { await mysql.keywordCollect(kw, source); } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items;
  if (!Array.isArray(arr)) arr = [];
  var hit = arr.find(function (x) { return String(x.keyword) === String(kw); });
  if (hit) { hit.source = source; hit.status = 1; }
  else arr.push({ keyword: kw, search_count: 0, is_hot: 0, sort_order: 0, status: 1, source: source });
  wr(KEYWORDS_FILE, { items: arr });
}
async function keywordEnsure(kw, fields) {
  try { await mysql.keywordEnsure(kw, fields); } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items;
  if (!Array.isArray(arr)) arr = [];
  var hit = arr.find(function (x) { return String(x.keyword) === String(kw); });
  if (hit) { hit.is_hot = fields.is_hot ? 1 : 0; hit.sort_order = fields.sort_order || 0; hit.status = fields.status === undefined ? 1 : fields.status; hit.source = fields.source || ""; }
  else arr.push({ keyword: kw, search_count: 0, is_hot: fields.is_hot ? 1 : 0, sort_order: fields.sort_order || 0, status: fields.status === undefined ? 1 : fields.status, source: fields.source || "" });
  wr(KEYWORDS_FILE, { items: arr });
}
async function keywordList(limit, onlyHot) {
  try {
    var rows = await mysql.keywordList(limit, onlyHot);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items;
  if (!Array.isArray(arr)) arr = [];
  arr = arr.filter(function (x) { return String(x.status) === "1" || x.status === 1; });
  if (onlyHot) arr = arr.filter(function (x) { return (x.is_hot === 1 || x.is_hot === "1") || (x.search_count || 0) > 0; });
  arr = arr.slice().sort(function (a, b) {
    var ha = (a.is_hot === 1 || a.is_hot === "1") ? 1 : 0, hb = (b.is_hot === 1 || b.is_hot === "1") ? 1 : 0;
    if (ha !== hb) return hb - ha;
    var sa = a.source ? 1 : 0, sb = b.source ? 1 : 0;
    if (sa !== sb) return sb - sa;
    if ((b.sort_order || 0) !== (a.sort_order || 0)) return (b.sort_order || 0) - (a.sort_order || 0);
    return (b.search_count || 0) - (a.search_count || 0);
  });
  return arr.slice(0, limit || 50);
}
async function keywordUpdate(id, fields) {
  try { await mysql.keywordUpdate(id, fields); } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items;
  for (var i = 0; i < arr.length; i++) {
    if (String(arr[i].id) === String(id)) { Object.assign(arr[i], fields); wr(KEYWORDS_FILE, { items: arr }); return; }
  }
}
async function keywordDelete(id) {
  try { await mysql.keywordDelete(id); } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items;
  wr(KEYWORDS_FILE, { items: arr.filter(function (x) { return String(x.id) !== String(id); }) });
}

// ---------- 资源热度榜（转存次数聚合） ----------
async function hotResources(limit) {
  try {
    var rows = await mysql.transferTop(limit);
    if (rows && rows.length !== undefined && rows.length > 0) return rows;
  } catch (e) {}
  var hist = safeRead(HISTORY_FILE, { records: [] }).records || [];
  var map = {};
  hist.forEach(function (r) {
    if (!r.success) return;
    var k = r.originalUrl || "";
    if (!map[k]) map[k] = { original_url: k, cnt: 0, title: r.title || "", type: r.type || "" };
    map[k].cnt++;
    if (r.title) map[k].title = r.title;
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.cnt - a.cnt; }).slice(0, limit || 10);
}

// ---------- 资源统计（首页真实收录数） ----------
async function resourceStats() {
  try {
    var st = await mysql.resourceStats();
    if (st && st.total !== undefined) return st;
  } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  var active = arr.filter(function (x) { return String(x.status) === "1" || x.status === 1; });
  var map = {};
  active.forEach(function (x) { map[x.disk_type] = (map[x.disk_type] || 0) + 1; });
  var valid = active.filter(function (x) { return x.link_valid === 1; }).length;
  return { total: active.length, byType: map, valid: valid };
}

// ---------- ai_summaries（后台 AI 提炼结果） ----------
async function aiSummaryAdd(rec) {
  try {
    var id = await mysql.aiSummaryAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var arr = safeRead(AI_SUMMARIES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  rec.id = rec.id || resNextId(arr);
  rec.created_at = rec.created_at || new Date().toISOString().slice(0, 19).replace("T", " ");
  arr.unshift(rec);
  if (arr.length > 200) arr = arr.slice(0, 200);
  wr(AI_SUMMARIES_FILE, arr);
  return rec.id;
}
async function aiSummaryList(limit) {
  try {
    var rows = await mysql.aiSummaryList(limit);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var arr = safeRead(AI_SUMMARIES_FILE, []);
  return (Array.isArray(arr) ? arr : []).slice(0, limit || 50);
}

// ---------- 一次性迁移 JSON -> MySQL ----------
async function migrateFromJson() {
  try { await mysql.ping(); } catch (e) { return null; }
  try {
    var done = await mysql.cfgGet("migration_v1", "");
    if (done === "1") return null;
  } catch (e) {}

  var log = [];
  try {
    var cfg = rd(PATHS.CFG, {});
    if (Object.keys(cfg).length) { await mysql.cfgSetAll(cfg); log.push("config " + Object.keys(cfg).length + " 项"); }
  } catch (e) { console.error("[migrate] config:", e.message); }
  try {
    var admJson = rd(PATHS.ADMIN, {});
    var a = await mysql.adminGet();
    if (admJson.password && (!a || !a.password_hash)) { await mysql.adminSetHash(admJson.password); log.push("admin 密码哈希"); }
  } catch (e) { console.error("[migrate] admin:", e.message); }
  try {
    var ck = safeRead(PATHS.COOKIES, {});
    var keys = Object.keys(ck);
    for (var i = 0; i < keys.length; i++) await mysql.cookieSet(keys[i], ck[keys[i]], 0);
    if (keys.length) log.push("cookies " + keys.length + " 个");
  } catch (e) { console.error("[migrate] cookies:", e.message); }
  try {
    var cd = rd(PATHS.CACHE, { links: {} });
    var urls = Object.keys(cd.links || {});
    for (var j = 0; j < urls.length; j++) {
      var v = cd.links[urls[j]];
      await mysql.cacheSet(urls[j], v.newUrl, v.pwd, v.note);
    }
    if (urls.length) log.push("cache " + urls.length + " 条");
  } catch (e) { console.error("[migrate] cache:", e.message); }
  try {
    var hist = safeRead(HISTORY_FILE, { records: [] });
    var recs = hist.records || [];
    for (var k = 0; k < recs.length; k++) await mysql.historyAdd(recs[k]);
    if (recs.length) log.push("history " + recs.length + " 条");
  } catch (e) { console.error("[migrate] history:", e.message); }

  try { await mysql.cfgSet("migration_v1", "1", "JSON->MySQL 一次性迁移标记"); } catch (e) {}
  return { migrated: true, log: log };
}

module.exports = {
  getConfig, saveConfig,
  getAdmin, verifyAdmin, setAdminPassword,
  getCookiesObj, saveCookie,
  cacheGet, cacheSet, cacheStats, cacheClear,
  historyAdd, historyList,
  getTrendingCache, saveTrendingCache,
  resourceAdd, resourceGet, resourceUpdate, resourceDelete, resourceCount, resourceExists, resourceSearch,
  submitAdd, submitList, submitReview,
  crawlerSourceList, crawlerSourceAdd, crawlerSourceUpdate, crawlerSourceDelete,
  crawlerRuleList, crawlerRuleAdd, crawlerRuleUpdate, crawlerRuleDelete,
  importLogAdd, importLogList, reportAdd, reportList,
  keywordRecord, keywordEnsure, keywordList, keywordUpdate, keywordDelete, keywordCollect,
  hotResources, resourceStats, aiSummaryAdd, aiSummaryList,
  migrateFromJson,
};
