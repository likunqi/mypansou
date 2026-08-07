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

// pansouBase 兼容单值字符串 / JSON 字符串 / 数组，归一化为 [{name,host,enabled,weight}]
async function getPansouBases() {
  var cfg = await getConfig();
  var raw = cfg.pansouBase;
  if (typeof raw === "string" && /^\[/.test(raw.trim())) {
    try { raw = JSON.parse(raw); } catch (e) {}
  }
  var def = { name: "默认", host: require("./storage").PANSOU_BASE, enabled: true, weight: 1 };
  var arr = [];
  if (Array.isArray(raw)) {
    raw.forEach(function (h) {
      if (!h || !h.host) return;
      arr.push({
        name: String(h.name || "").trim() || h.host,
        host: String(h.host).trim(),
        enabled: h.enabled !== false,
        weight: parseInt(h.weight, 10) > 0 ? parseInt(h.weight, 10) : 1,
      });
    });
    if (!arr.length) arr.push(def);
  } else if (typeof raw === "string" && raw.trim()) {
    arr.push({ name: "默认", host: raw.trim(), enabled: true, weight: 1 });
  } else {
    arr.push(def);
  }
  return arr;
}
// 按权重随机选一个启用 host（传入已排除已尝试项的列表）
function pickPansouBase(list) {
  var enabled = (list || []).filter(function (h) { return h && h.enabled && h.host; });
  if (!enabled.length) enabled = (list || []).filter(function (h) { return h && h.host; });
  if (!enabled.length) return null;
  var total = enabled.reduce(function (s, h) { return s + (h.weight || 1); }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < enabled.length; i++) {
    r -= (enabled[i].weight || 1);
    if (r <= 0) return enabled[i];
  }
  return enabled[enabled.length - 1];
}

// 站点配置（TDK/favicon/自定义代码），缺失字段用默认值
async function getSiteConfig() {
  var cfg = await getConfig();
  return {
    site_name: cfg.site_name || "云盘搜",
    site_description: cfg.site_description || "网盘资源搜索引擎，聚合夸克/百度/阿里云盘资源搜索与转存",
    site_keywords: cfg.site_keywords || "云盘搜索,夸克网盘,百度网盘",
    site_favicon: cfg.site_favicon || "",
    site_custom_head: cfg.site_custom_head || "",
    // 公告（最多 3 条，前台顶部跑马灯）+ 广告位（home_hero/home_list/search_top/search_bottom）
    site_notices: parseArr(cfg.site_notices),
    site_ads: parseArr(cfg.site_ads),
  };
}
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) { try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) {} }
  return [];
}
async function saveSiteConfig(obj) {
  var clean = {};
  ["site_name", "site_description", "site_keywords", "site_favicon", "site_custom_head"].forEach(function (k) {
    if (obj[k] !== undefined) clean[k] = String(obj[k]);
  });
  // 数组字段 JSON 化存储（getSiteConfig 读回自动解析）
  ["site_notices", "site_ads"].forEach(function (k) {
    if (Array.isArray(obj[k])) clean[k] = JSON.stringify(obj[k]);
  });
  await saveConfig(clean);
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
// 多账号列表（MySQL 为主；JSON 兜底旧结构 {provider: enc}）
async function getCookieAccounts() {
  try {
    var rows = await mysql.cookieList();
    if (rows && rows.length) {
      return rows.map(function (r) {
        return { id: r.id, provider: r.provider, name: r.name || "", encrypted: r.encrypted_value, is_valid: !!r.is_valid, enabled: !!r.enabled, last_tested_at: r.last_tested_at || null };
      });
    }
  } catch (e) {}
  var obj = safeRead(PATHS.COOKIES, {});
  var arr = [];
  for (var p in obj) arr.push({ id: 0, provider: p, name: "", encrypted: obj[p], is_valid: false, enabled: true, last_tested_at: null });
  return arr;
}
async function saveCookie(provider, encValue) {
  try { await mysql.cookieSet(provider, encValue, 0); } catch (e) {}
  var obj = safeRead(PATHS.COOKIES, {});
  obj[provider] = encValue;
  wr(PATHS.COOKIES, obj);
}
async function cookieAdd(provider, encValue, name) {
  try { await mysql.cookieAdd(provider, encValue, name); } catch (e) {}
  var obj = safeRead(PATHS.COOKIES, {});
  obj[provider + ":" + (name || Date.now())] = encValue;
  wr(PATHS.COOKIES, obj);
}
async function cookieUpdate(id, fields) {
  try { await mysql.cookieUpdate(id, fields); } catch (e) {}
}
async function cookieDelete(id) {
  try { await mysql.cookieDelete(id); } catch (e) {}
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
  if (!rec.id) rec.id = "j" + Date.now() + Math.floor(Math.random() * 1000); // JSON 镜像自增 id（MySQL 侧以自增主键为准）
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
async function historyDelete(ids) {
  try { await mysql.historyDelete(ids); } catch (e) {}
  if (!ids || !ids.length) return;
  var set = {};
  ids.forEach(function (i) { set[String(i)] = 1; });
  var hist = safeRead(HISTORY_FILE, { records: [] });
  var before = (hist.records || []).length;
  hist.records = (hist.records || []).filter(function (r) { return !set[String(r.id)]; });
  if (hist.records.length !== before) wr(HISTORY_FILE, hist);
}
async function historyClear() {
  try { await mysql.historyClear(); } catch (e) {}
  wr(HISTORY_FILE, { records: [] });
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
async function resourceDeleteBatch(ids) {
  var idset = {};
  (ids || []).forEach(function (x) { idset[String(x)] = true; });
  var n = 0;
  try { n = await mysql.resourceDeleteBatch(ids); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  var kept = arr.filter(function (x) { return !idset[String(x.id)]; });
  if (kept.length !== arr.length) wr(RESOURCES_FILE, kept);
  return n || Object.keys(idset).length;
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
// 资源导出全量（无分页上限）
async function resourceExportAll(opt) {
  try {
    var rows = await mysql.resourceExportAll(opt);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  // JSON 兜底：走 resourceSearch 逻辑取前 5000
  var r = await resourceSearch(Object.assign({}, opt, { page: "1", size: "100" }));
  return r.items || [];
}

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
    if (opt.link_status === "valid" && Number(x.link_valid) !== 1) return false;
    if (opt.link_status === "invalid" && Number(x.link_valid) !== 0) return false;
    if (opt.link_status === "notchecked" && x.last_checked_at) return false;
    if (opt.exclude_invalid && Number(x.link_valid) === 0) return false;
    if (opt.created_from) { if (String(x.created_at || "").slice(0, 10) < opt.created_from) return false; }
    if (opt.created_to) { if (String(x.created_at || "").slice(0, 10) > opt.created_to) return false; }
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

// ---------- 资源热度榜（resources 表驱动，转存次数排前） ----------
async function hotResources(limit) {
  try {
    var rows = await mysql.resourceHot(limit);
    if (rows && rows.length !== undefined && rows.length > 0) return rows;
  } catch (e) {}
  // JSON 兜底：从资源文件取 status=1 前 N 条
  var arr = safeRead(RESOURCES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  return arr.filter(function (r) { return r.status === 1; })
    .slice(0, limit || 10)
    .map(function (r) { return { title: r.title || "", url: r.url || "", disk_type: r.disk_type || "", category: r.category || "", cnt: 0 }; });
}

// ---------- 资源热榜手动配置（hot_rankings，MySQL 优先 + JSON 兜底） ----------
const HOT_RANKINGS_FILE = path.join(PATHS.DATA_DIR, "hot_rankings.json");
async function hotRankAdd(resource) {
  try { return await mysql.hotRankAdd(resource); } catch (e) {}
  // JSON 兜底
  var arr = safeRead(HOT_RANKINGS_FILE, []);
  var next = arr.reduce(function (m, x) { return Math.max(m, x.sort_order || 0); }, 0) + 1;
  var exists = arr.find(function (x) { return x.resource_id === parseInt(resource.id, 10); });
  if (exists) { exists.title = resource.title || ""; exists.url = resource.url || ""; exists.disk_type = resource.disk_type || ""; exists.category = resource.category || ""; exists.status = 1; }
  else arr.push({ id: next, resource_id: parseInt(resource.id, 10) || 0, title: resource.title || "", url: resource.url || "", disk_type: resource.disk_type || "", category: resource.category || "", sort_order: next, status: 1 });
  wr(HOT_RANKINGS_FILE, arr);
  return next;
}
async function hotRankList() {
  try {
    var rows = await mysql.hotRankList();
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  return safeRead(HOT_RANKINGS_FILE, []).filter(function (x) { return x.status !== 0; })
    .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0); });
}
async function hotRankSaveSort(ids) {
  try { return await mysql.hotRankSaveSort(ids); } catch (e) {}
  var arr = safeRead(HOT_RANKINGS_FILE, []);
  (ids || []).forEach(function (id, i) { var x = arr.find(function (r) { return String(r.id) === String(id); }); if (x) x.sort_order = i + 1; });
  wr(HOT_RANKINGS_FILE, arr);
  return (ids || []).length;
}
async function hotRankRemove(id) {
  try { await mysql.hotRankRemove(id); } catch (e) {}
  var arr = safeRead(HOT_RANKINGS_FILE, []);
  wr(HOT_RANKINGS_FILE, arr.filter(function (x) { return String(x.id) !== String(id); }));
}
async function hotRankedIds() {
  try {
    var ids = await mysql.hotRankedIds();
    if (ids && ids.length !== undefined) return ids;
  } catch (e) {}
  return safeRead(HOT_RANKINGS_FILE, []).map(function (x) { return x.resource_id; });
}

// ---------- 失效反馈（link_feedback，MySQL 优先 + JSON 兜底） ----------
const FEEDBACK_FILE = path.join(PATHS.DATA_DIR, "link_feedback.json");
async function feedbackAdd(rec) {
  try { return await mysql.feedbackAdd(rec); } catch (e) {}
  var arr = safeRead(FEEDBACK_FILE, []);
  var dup = arr.find(function (x) { return x.resource_id === parseInt(rec.resource_id, 10) && x.status === 0; });
  if (dup) return dup.id;
  var id = Date.now();
  arr.push({ id: id, resource_id: parseInt(rec.resource_id, 10) || 0, title: rec.title || "", url: rec.url || "", disk_type: rec.disk_type || "", status: 0, admin_remark: "", created_at: new Date().toISOString() });
  wr(FEEDBACK_FILE, arr);
  return id;
}
async function feedbackList(status) {
  try {
    var rows = await mysql.feedbackList(status);
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  var arr = safeRead(FEEDBACK_FILE, []);
  if (status !== undefined && status !== null && status !== "") arr = arr.filter(function (x) { return x.status === Number(status); });
  return arr.sort(function (a, b) { return b.id - a.id; });
}
async function feedbackUpdate(id, fields) {
  try { await mysql.feedbackUpdate(id, fields); return; } catch (e) {}
  var arr = safeRead(FEEDBACK_FILE, []);
  var x = arr.find(function (r) { return String(r.id) === String(id); });
  if (x) { if (fields.status !== undefined) x.status = fields.status; if (fields.admin_remark !== undefined) x.admin_remark = fields.admin_remark; wr(FEEDBACK_FILE, arr); }
}
async function feedbackDelete(id) {
  try { await mysql.feedbackDelete(id); return; } catch (e) {}
  var arr = safeRead(FEEDBACK_FILE, []);
  wr(FEEDBACK_FILE, arr.filter(function (x) { return String(x.id) !== String(id); }));
}

// ---------- 资源统计（首页真实收录数） ----------
async function resourceStats() {
  try {
    var st = await mysql.resourceStats();
    if (st && st.total !== undefined) return st;
  } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  var active = arr.filter(function (x) { return String(x.status) === "1" || x.status === 1; });  var map = {};
  active.forEach(function (x) { map[x.disk_type] = (map[x.disk_type] || 0) + 1; });
  var valid = active.filter(function (x) { return x.link_valid === 1; }).length;
  return { total: active.length, byType: map, valid: valid };
}
async function resourceCountBySource() {
  try {
    var map = await mysql.resourceCountBySource();
    if (map && typeof map === "object") return map;
  } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  if (!Array.isArray(arr)) arr = [];
  var out = {};
  arr.forEach(function (x) { if (x.source_id) out[String(x.source_id)] = (out[String(x.source_id)] || 0) + 1; });
  return out;
}
async function keywordCount() {
  try { return await mysql.keywordCount(); } catch (e) {}
  var arr = safeRead(KEYWORDS_FILE, { items: [] }).items || [];
  return arr.filter(function (k) { return String(k.status) === "1" || k.status === 1; }).length;
}
async function transferStats() {
  try { return await mysql.transferStats(); } catch (e) {}
  var hist = safeRead(HISTORY_FILE, { records: [] }).records || [];
  var today0 = new Date(); today0.setHours(0, 0, 0, 0);
  return {
    total: hist.filter(function (r) { return r.success; }).length,
    today: hist.filter(function (r) { return r.success && r.createdAt >= today0.getTime(); }).length,
  };
}

// ---------- categories（资源分类字典） ----------
function categoryJson() { return safeRead(path.join(PATHS.DATA_DIR, "categories.json"), { items: [] }); }
async function categoryList() {
  try {
    var rows = await mysql.categoryList();
    if (rows && rows.length !== undefined) return rows;
  } catch (e) {}
  return categoryJson().items || [];
}
async function categoryAdd(rec) {
  try {
    var id = await mysql.categoryAdd(rec);
    rec.id = id;
  } catch (e) { rec.id = null; }
  var d = categoryJson();
  rec.id = rec.id || (d.items.length ? Math.max.apply(null, d.items.map(function (x) { return x.id; })) + 1 : 1);
  d.items.unshift(rec);
  wr(path.join(PATHS.DATA_DIR, "categories.json"), d);
  return rec.id;
}
async function categoryUpdate(id, fields) {
  try { await mysql.categoryUpdate(id, fields); } catch (e) {}
  var d = categoryJson();
  for (var i = 0; i < d.items.length; i++) {
    if (String(d.items[i].id) === String(id)) { Object.assign(d.items[i], fields); wr(path.join(PATHS.DATA_DIR, "categories.json"), d); return; }
  }
}
async function categoryDelete(id) {
  try { await mysql.categoryDelete(id); } catch (e) {}
  var d = categoryJson();
  d.items = d.items.filter(function (x) { return String(x.id) !== String(id); });
  wr(path.join(PATHS.DATA_DIR, "categories.json"), d);
}
async function categoryRefCounts() {
  try {
    var map = await mysql.categoryRefCounts();
    if (map && typeof map === "object") return map;
  } catch (e) {}
  return {};
}
// 分类改名 / 删除联动（引用同步；MySQL 失败时 JSON 镜像同步 resources）
async function categoryRenameRefs(oldName, newName) {
  try { await mysql.categoryRenameRefs(oldName, newName); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  if (Array.isArray(arr)) {
    var changed = false;
    arr.forEach(function (x) { if (x.category === oldName) { x.category = newName; changed = true; } });
    if (changed) wr(RESOURCES_FILE, arr);
  }
}
async function categoryClearRefs(name) {
  try { await mysql.categoryClearRefs(name); } catch (e) {}
  var arr = safeRead(RESOURCES_FILE, []);
  if (Array.isArray(arr)) {
    var changed = false;
    arr.forEach(function (x) { if (x.category === name) { x.category = ""; changed = true; } });
    if (changed) wr(RESOURCES_FILE, arr);
  }
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
  getConfig, saveConfig, getPansouBases, pickPansouBase, getSiteConfig, saveSiteConfig,
  getAdmin, verifyAdmin, setAdminPassword,
  getCookiesObj, saveCookie, getCookieAccounts, cookieAdd, cookieUpdate, cookieDelete,
  cacheGet, cacheSet, cacheStats, cacheClear,
  historyAdd, historyList, historyDelete, historyClear,
  getTrendingCache, saveTrendingCache,
  resourceAdd, resourceGet, resourceUpdate, resourceDelete, resourceDeleteBatch, resourceCount, resourceExists, resourceSearch, resourceExportAll,
  submitAdd, submitList, submitReview,
  crawlerSourceList, crawlerSourceAdd, crawlerSourceUpdate, crawlerSourceDelete,
  crawlerRuleList, crawlerRuleAdd, crawlerRuleUpdate, crawlerRuleDelete,
  importLogAdd, importLogList, reportAdd, reportList,
  keywordRecord, keywordEnsure, keywordList, keywordUpdate, keywordDelete, keywordCollect,
  hotResources, resourceStats, keywordCount, transferStats, resourceCountBySource, aiSummaryAdd, aiSummaryList,
  hotRankAdd, hotRankList, hotRankSaveSort, hotRankRemove, hotRankedIds,
  feedbackAdd, feedbackList, feedbackUpdate, feedbackDelete,
  categoryList, categoryAdd, categoryUpdate, categoryDelete, categoryRefCounts, categoryRenameRefs, categoryClearRefs,
  migrateFromJson,
};
