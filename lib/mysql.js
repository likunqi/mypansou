// lib/mysql.js — MySQL 存储适配器（mysql2）
// 云盘搜的 NAS MySQL 接入层。连接配置优先级：环境变量 PANSOU_MYSQL_* > data/db.config.json > 默认值。
// 设计原则：MySQL 不可用时全部降级，不阻塞服务器启动；现有 JSON 存储保持兼容。
const fs = require("fs");
const path = require("path");
const crypto = require("./crypto");

const DATA_DIR = path.join(__dirname, "..", "data");

function loadConfig() {
  var env = {
    host: process.env.PANSOU_MYSQL_HOST,
    port: process.env.PANSOU_MYSQL_PORT,
    user: process.env.PANSOU_MYSQL_USER,
    password: process.env.PANSOU_MYSQL_PASSWORD,
    database: process.env.PANSOU_MYSQL_DATABASE,
  };
  var fileCfg = {};
  var fp = path.join(DATA_DIR, "db.config.json");
  try { fileCfg = JSON.parse(fs.readFileSync(fp, "utf8")); } catch (e) {}
  return {
    host: env.host || fileCfg.host || "192.168.1.65",
    port: parseInt(env.port || fileCfg.port || "3306", 10),
    user: env.user || fileCfg.user || "pansou",
    password: env.password || fileCfg.password || "Srcloud@216",
    database: env.database || fileCfg.database || "pansou",
  };
}

var pool = null;
var ready = false;
var cfg = null;

function getPool() {
  if (!pool) {
    cfg = loadConfig();
    var mysql = require("mysql2/promise");
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      charset: "utf8mb4",
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 5000,
    });
    // 连接池错误监听：避免空闲连接断开等错误导致进程崩溃，自动降级 JSON
    pool.on("error", function (err) {
      ready = false;
      console.error("[mysql] 连接池错误（降级 JSON）:", err.message);
    });
  }
  return pool;
}

async function ping() {
  var p = getPool();
  var conn = await p.getConnection();
  try { await conn.ping(); ready = true; return true; }
  finally { conn.release(); }
}

async function query(sql, params) {
  var p = getPool();
  var rows = await p.query(sql, params || []);
  return rows[0];
}

async function execute(sql, params) {
  var p = getPool();
  var result = await p.execute(sql, params || []);
  return result[0];
}

function isReady() { return ready; }

// ---- site_config（替代 config.json）----
async function cfgGetAll() {
  var rows = await query("SELECT config_key, config_value FROM site_config");
  var out = {};
  for (var i = 0; i < rows.length; i++) out[rows[i].config_key] = rows[i].config_value;
  return out;
}
async function cfgGet(key, def) {
  var rows = await query("SELECT config_value FROM site_config WHERE config_key=?", [key]);
  return rows.length ? rows[0].config_value : def;
}
async function cfgSet(key, value, desc) {
  await execute(
    "INSERT INTO site_config (config_key, config_value, description) VALUES (?,?,?) " +
    "ON DUPLICATE KEY UPDATE config_value=VALUES(config_value), description=COALESCE(VALUES(description), description)",
    [key, String(value), desc || null]
  );
}

// ---- admin_users（替代 admin.json）----
async function adminGet() {
  var rows = await query("SELECT id, username, password_hash, role FROM admin_users LIMIT 1");
  return rows[0] || null;
}
async function adminVerify(pw) {
  var a = await adminGet();
  if (!a || !a.password_hash) return false;
  return crypto.verify(pw, a.password_hash);
}
async function adminSet(pw) {
  var h = crypto.hash(pw);
  var a = await adminGet();
  if (a) await execute("UPDATE admin_users SET password_hash=?, updated_at=NOW() WHERE id=?", [h, a.id]);
  else await execute("INSERT INTO admin_users (username, password_hash, role) VALUES ('admin', ?, 'admin')", [h]);
}

// ---- cookies（替代 cookies.enc）----
async function cookieGet(provider) {
  var rows = await query("SELECT encrypted_value, is_valid FROM cookies WHERE provider=?", [provider]);
  return rows[0] || null;
}
async function cookieSet(provider, encValue, isValid) {
  await execute(
    "INSERT INTO cookies (provider, encrypted_value, is_valid) VALUES (?,?,?) " +
    "ON DUPLICATE KEY UPDATE encrypted_value=VALUES(encrypted_value), is_valid=VALUES(is_valid)",
    [provider, encValue, isValid ? 1 : 0]
  );
}

// ---- transfer_cache（替代 cache.json）----
async function cacheGet(url) {
  var rows = await query(
    "SELECT new_url, pwd, note FROM transfer_cache WHERE original_url=? ORDER BY id DESC LIMIT 1", [url]);
  if (!rows.length) return null;
  return { newUrl: rows[0].new_url, pwd: rows[0].pwd || "", note: rows[0].note || "" };
}
async function cacheSet(url, newUrl, pwd, note) {
  await execute(
    "INSERT INTO transfer_cache (original_url, new_url, pwd, note) VALUES (?,?,?,?)",
    [url, newUrl, pwd || "", note || ""]);
}
async function cacheStats() {
  var rows = await query("SELECT COUNT(*) AS c FROM transfer_cache");
  return { total: rows[0].c, quark: 0, baidu: 0 };
}
async function cacheClear() {
  await execute("DELETE FROM transfer_cache");
}

// ---- transfer_history（替代 transfer_history.json）----
function toSqlDt(ms) {
  if (!ms) return null;
  var d = new Date(ms);
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
async function historyAdd(rec) {
  await execute(
    "INSERT INTO transfer_history (original_url, new_url, pwd, type, title, success, created_at) VALUES (?,?,?,?,?,?,?)",
    [rec.originalUrl || "", rec.newUrl || "", rec.pwd || "", rec.type || "quark", rec.title || "", rec.success ? 1 : 0, toSqlDt(rec.createdAt)]);
}
async function historyList(limit) {
  var rows = await query(
    "SELECT original_url, new_url, pwd, type, title, success, created_at FROM transfer_history ORDER BY created_at DESC, id DESC LIMIT ?",
    [Math.min(limit || 50, 200)]);
  return rows.map(function (r) {
    return {
      originalUrl: r.original_url, newUrl: r.new_url, pwd: r.pwd || "",
      type: r.type, title: r.title || "", success: !!r.success,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    };
  });
}
// 清理时间点之前的历史/缓存记录（定时任务用，保当天）
async function historyDeleteBefore(ts) {
  await execute("DELETE FROM transfer_history WHERE created_at < ?", [toSqlDt(ts)]);
}
async function cacheDeleteBefore(ts) {
  await execute("DELETE FROM transfer_cache WHERE created_at < ?", [toSqlDt(ts)]);
}

// ---- cookies 全量读取（替代 cookies.enc 直接读）----
async function cookieGetAll() {
  var rows = await query("SELECT provider, encrypted_value FROM cookies");
  var out = {};
  for (var i = 0; i < rows.length; i++) out[rows[i].provider] = rows[i].encrypted_value;
  return out;
}

// ---- admin 哈希直导（迁移用）----
async function adminSetHash(h) {
  var a = await adminGet();
  if (a) await execute("UPDATE admin_users SET password_hash=?, updated_at=NOW() WHERE id=?", [h, a.id]);
  else await execute("INSERT INTO admin_users (username, password_hash, role) VALUES ('admin', ?, 'admin')", [h]);
}

// ---- site_config 批量写（迁移用）----
async function cfgSetAll(obj) {
  for (var k in obj) await cfgSet(k, obj[k], null);
}

// ---- resources（本地搜索核心数据源 / 三管道目标表）----
async function resourceAdd(rec) {
  var r = await execute(
    "INSERT INTO resources (title, url, password, disk_type, category, tags, description, file_name, file_size, source, source_id, status, link_valid, check_message, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
    [rec.title, rec.url, rec.password || "", rec.disk_type || "quark", rec.category || "", rec.tags || "",
      rec.description || null, rec.file_name || "", rec.file_size || "", rec.source || "manual",
      rec.source_id || "", rec.status === undefined ? 1 : rec.status, rec.link_valid ? 1 : 0, rec.check_message || ""]);
  return r.insertId;
}
async function resourceGet(id) {
  var rows = await query("SELECT * FROM resources WHERE id=?", [id]);
  return rows[0] || null;
}
async function resourceUpdate(id, fields) {
  var allowed = ["title","url","password","disk_type","category","tags","description","file_name","file_size",
    "status","link_valid","check_message","last_checked_at","check_fail_count"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k] === null ? null : fields[k]);
  }
  if (!sets.length) return;
  sets.push("updated_at=NOW()");
  params.push(id);
  await execute("UPDATE resources SET " + sets.join(",") + " WHERE id=?", params);
}
async function resourceDelete(id) { await execute("DELETE FROM resources WHERE id=?", [id]); }
async function resourceCount() {
  var rows = await query("SELECT COUNT(*) AS c FROM resources");
  return rows[0].c;
}
async function resourceExists(url) {
  var rows = await query("SELECT id FROM resources WHERE url=? LIMIT 1", [url]);
  return rows.length > 0;
}
// 本地搜索 / 资源列表
// opt: {kw, category, diskType, source, status, page, size, order}
async function resourceSearch(opt) {
  opt = opt || {};
  var where = [], params = [];
  if (opt.kw) {
    where.push("(title LIKE ? OR description LIKE ? OR category LIKE ?)");
    var like = "%" + opt.kw + "%";
    params.push(like, like, like);
  }
  if (opt.category) { where.push("category=?"); params.push(opt.category); }
  if (opt.diskType) { where.push("disk_type=?"); params.push(opt.diskType); }
  if (opt.source) { where.push("source=?"); params.push(opt.source); }
  if (opt.status !== undefined && opt.status !== null && opt.status !== "") { where.push("status=?"); params.push(opt.status); }
  var w = where.length ? "WHERE " + where.join(" AND ") : "";
  var page = Math.max(parseInt(opt.page || "1", 10), 1);
  var size = Math.min(Math.max(parseInt(opt.size || "20", 10), 1), 100);
  var order = opt.order || "created_at DESC, id DESC";
  var cRows = await query("SELECT COUNT(*) AS c FROM resources " + w, params);
  var rows = await query("SELECT * FROM resources " + w + " ORDER BY " + order + " LIMIT ? OFFSET ?",
    params.concat([size, (page - 1) * size]));
  return { total: cRows[0].c, page: page, size: size, items: rows };
}

// ---- submitted_resources（人工提交审核）----
async function submitAdd(rec) {
  var r = await execute(
    "INSERT INTO submitted_resources (title, url, password, disk_type, description, category, submitter_name, submitter_contact, status, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,0,NOW())",
    [rec.title, rec.url, rec.password || "", rec.disk_type || "quark", rec.description || null,
      rec.category || "", rec.submitter_name || "", rec.submitter_contact || ""]);
  return r.insertId;
}
async function submitGet(id) {
  var rows = await query("SELECT * FROM submitted_resources WHERE id=?", [id]);
  return rows[0] || null;
}
async function submitList(status, page, size) {
  var where = status === undefined || status === null || status === "" ? "" : "WHERE status=?";
  var params = status === undefined || status === null || status === "" ? [] : [status];
  page = Math.max(parseInt(page || "1", 10), 1);
  size = Math.min(Math.max(parseInt(size || "20", 10), 1), 100);
  var cRows = await query("SELECT COUNT(*) AS c FROM submitted_resources " + where, params);
  var rows = await query("SELECT * FROM submitted_resources " + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    params.concat([size, (page - 1) * size]));
  return { total: cRows[0].c, page: page, size: size, items: rows };
}
// 审核：approve(status=1, resource_id) / reject(status=2, admin_remark)
async function submitReview(id, status, adminRemark, resourceId) {
  await execute(
    "UPDATE submitted_resources SET status=?, admin_remark=?, resource_id=?, reviewed_at=NOW() WHERE id=?",
    [status, adminRemark || "", resourceId || null, id]);
}

// ---- crawler_sources（采集源）----
async function crawlerSourceList(onlyActive) {
  var w = onlyActive ? "WHERE status=1" : "";
  return query("SELECT * FROM crawler_sources " + w + " ORDER BY id DESC");
}
async function crawlerSourceAdd(rec) {
  var r = await execute(
    "INSERT INTO crawler_sources (name, description, source_type, url_template, page_start, page_end, page_param, encoding, interval_mins, status, category, disk_type, use_proxy, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
    [rec.name, rec.description || "", rec.source_type, rec.url_template,
      rec.page_start || 1, rec.page_end || 1, rec.page_param || "/page/{page}", rec.encoding || "utf-8",
      rec.interval_mins || 0, rec.status === undefined ? 1 : rec.status,
      rec.category || "", rec.disk_type || "", rec.use_proxy ? 1 : 0]);
  return r.insertId;
}
async function crawlerSourceUpdate(id, fields) {
  var allowed = ["name","description","source_type","url_template","page_start","page_end","page_param",
    "encoding","interval_mins","status","category","disk_type","use_proxy","last_crawled_at"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k] === null ? null : fields[k]);
  }
  if (!sets.length) return;
  sets.push("updated_at=NOW()");
  params.push(id);
  await execute("UPDATE crawler_sources SET " + sets.join(",") + " WHERE id=?", params);
}
async function crawlerSourceDelete(id) {
  await execute("DELETE FROM crawler_rules WHERE source_id=?", [id]); // 级联删规则
  await execute("DELETE FROM crawler_sources WHERE id=?", [id]);
}

// ---- crawler_rules（解析规则）----
async function crawlerRuleList(sourceId) {
  var w = sourceId ? "WHERE source_id=?" : "";
  var p = sourceId ? [sourceId] : [];
  return query("SELECT * FROM crawler_rules " + w + " ORDER BY source_id, position", p);
}
async function crawlerRuleAdd(rec) {
  var r = await execute(
    "INSERT INTO crawler_rules (source_id, field_name, rule_type, rule_value, attr_name, filter_regex, default_value, required, position, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,NOW())",
    [rec.source_id, rec.field_name, rec.rule_type || "css", rec.rule_value,
      rec.attr_name || "", rec.filter_regex || "", rec.default_value || "", rec.required ? 1 : 0, rec.position || 0]);
  return r.insertId;
}
async function crawlerRuleUpdate(id, fields) {
  var allowed = ["source_id","field_name","rule_type","rule_value","attr_name","filter_regex","default_value","required","position"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k] === null ? null : fields[k]);
  }
  if (!sets.length) return;
  params.push(id);
  await execute("UPDATE crawler_rules SET " + sets.join(",") + " WHERE id=?", params);
}
async function crawlerRuleDelete(id) { await execute("DELETE FROM crawler_rules WHERE id=?", [id]); }

// ---- import_logs（批量导入日志）----
async function importLogAdd(rec) {
  var r = await execute(
    "INSERT INTO import_logs (file_name, file_format, total_rows, imported_rows, skipped_rows, duplicate_urls, category, disk_type, status, error_msg, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,NOW())",
    [rec.file_name || "", rec.file_format || "json", rec.total_rows || 0, rec.imported_rows || 0,
      rec.skipped_rows || 0, rec.duplicate_urls || 0, rec.category || "", rec.disk_type || "",
      rec.status || "completed", rec.error_msg || null]);
  return r.insertId;
}
async function importLogList(limit) {
  return query("SELECT * FROM import_logs ORDER BY created_at DESC, id DESC LIMIT ?", [Math.min(limit || 50, 200)]);
}

// ---- broken_link_reports（失效反馈）----
async function reportAdd(rec) {
  var r = await execute(
    "INSERT INTO broken_link_reports (resource_id, url, reason, reporter_ip, created_at) VALUES (?,?,?,?,NOW())",
    [rec.resource_id || null, rec.url || "", rec.reason || "", rec.reporter_ip || ""]);
  return r.insertId;
}

// ---- search_keywords（热搜关键词）----
// 采集：INSERT ... ON DUPLICATE KEY UPDATE search_count+1（uk_keyword 唯一键）
async function keywordUpsert(kw) {
  await execute(
    "INSERT INTO search_keywords (keyword, search_count, is_hot, sort_order, status) VALUES (?,1,0,0,1) " +
    "ON DUPLICATE KEY UPDATE search_count=search_count+1",
    [kw]);
}
// 手动新增/置热：已存在则更新 is_hot/sort_order/status，不存在则插入
async function keywordEnsure(kw, fields) {
  await execute(
    "INSERT INTO search_keywords (keyword, search_count, is_hot, sort_order, status) VALUES (?,0,?,?,?) " +
    "ON DUPLICATE KEY UPDATE is_hot=VALUES(is_hot), sort_order=VALUES(sort_order), status=VALUES(status)",
    [kw, fields.is_hot ? 1 : 0, fields.sort_order || 0, fields.status === undefined ? 1 : fields.status]);
}
async function keywordList(limit, onlyHot) {
  var w = onlyHot ? "WHERE status=1 AND (is_hot=1 OR search_count>0)" : "WHERE status=1";
  return query(
    "SELECT id, keyword, search_count, is_hot, sort_order, status FROM search_keywords " + w +
    " ORDER BY is_hot DESC, sort_order DESC, search_count DESC, id DESC LIMIT ?",
    [Math.min(limit || 50, 100)]);
}
async function keywordUpdate(id, fields) {
  var allowed = ["is_hot", "sort_order", "status", "search_count"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k]);
  }
  if (!sets.length) return;
  params.push(id);
  await execute("UPDATE search_keywords SET " + sets.join(",") + ", updated_at=NOW() WHERE id=?", params);
}
async function keywordDelete(id) { await execute("DELETE FROM search_keywords WHERE id=?", [id]); }

// ---- 转存热度（资源热度榜：transfer_history 按 original_url 聚合）----
async function transferTop(limit) {
  var rows = await query(
    "SELECT original_url, COUNT(*) AS cnt, MAX(title) AS title, MAX(type) AS type " +
    "FROM transfer_history WHERE success=1 GROUP BY original_url ORDER BY cnt DESC, MAX(id) DESC LIMIT ?",
    [Math.min(limit || 10, 50)]);
  return rows;
}

// ---- ai_summaries（后台 AI 提炼结果）----
async function aiSummaryAdd(rec) {
  var r = await execute(
    "INSERT INTO ai_summaries (scope, input_text, output_text, model, status, created_at) VALUES (?,?,?,?,?,NOW())",
    [rec.scope || "", rec.input_text || null, rec.output_text || null, rec.model || "", rec.status || "ok"]);
  return r.insertId;
}
async function aiSummaryList(limit) {
  return query("SELECT * FROM ai_summaries ORDER BY id DESC LIMIT ?", [Math.min(limit || 50, 200)]);
}

// ---- broken_link_reports 全量（AI 提炼用）----
async function reportList(limit) {
  return query("SELECT * FROM broken_link_reports ORDER BY id DESC LIMIT ?", [Math.min(limit || 100, 500)]);
}

// ---- 元信息 ----
async function tableCount() {
  var rows = await query(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=?", [cfg.database]);
  return rows[0].c;
}

// 关闭连接池（CLI 脚本结束时调用，避免进程悬挂）
async function close() {
  if (pool) { try { await pool.end(); } catch (e) {} pool = null; ready = false; }
}

// ---- 启动初始化：ping + 种子数据 ----
async function ensureTable() {
  // ai_summaries 表（AI 提炼结果保存，幂等建表）
  await execute(
    "CREATE TABLE IF NOT EXISTS ai_summaries (" +
    "id INT PRIMARY KEY AUTO_INCREMENT, " +
    "scope VARCHAR(32) DEFAULT '', " +
    "input_text TEXT DEFAULT NULL, " +
    "output_text MEDIUMTEXT DEFAULT NULL, " +
    "model VARCHAR(64) DEFAULT '', " +
    "status VARCHAR(16) DEFAULT 'ok', " +
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

async function ensureSeed() {
  var rows = await query("SELECT COUNT(*) AS c FROM site_config");
  if (rows[0].c === 0) {
    var defaults = [
      ["pansouBase", "so.252035.xyz", "盘搜 API 地址"],
      ["quarkDir", "0", "夸克转存目标目录 fid"],
      ["baiduDir", "/", "百度转存目标目录路径"],
      ["shareUrlPrefix", "", "分享链接前缀替换"],
      ["site_name", "云盘搜", "网站名称"],
      ["site_keywords", "云盘搜索,夸克网盘,百度网盘", "SEO 关键词"],
      ["site_description", "网盘资源搜索引擎", "SEO 描述"],
      ["encKey", "", "AES 加密密钥"],
      ["task_interval_cleanup", "86400", "资源清理间隔(秒)"],
      ["task_interval_check", "3600", "链接检测间隔(秒)"],
    ];
    for (var i = 0; i < defaults.length; i++) {
      await cfgSet(defaults[i][0], defaults[i][1], defaults[i][2]);
    }
  }
  var adm = await adminGet();
  if (!adm || !adm.password_hash) await adminSet("admin123");
}

async function init() {
  await ping();
  await ensureTable();
  await ensureSeed();
  var t = await tableCount();
  console.log("[mysql] 已连接 " + cfg.host + ":" + cfg.port + "/" + cfg.database + "，表数量 " + t);
  return { ready: true, tables: t };
}

async function status() {
  try {
    await ping();
    var t = await tableCount();
    return { ready: true, host: cfg.host, port: cfg.port, database: cfg.database, tables: t };
  } catch (e) {
    return { ready: false, error: e.message };
  }
}

module.exports = {
  loadConfig, ping, isReady, query, execute,
  cfgGet, cfgGetAll, cfgSet, cfgSetAll,
  adminGet, adminVerify, adminSet, adminSetHash,
  cookieGet, cookieSet, cookieGetAll,
  cacheGet, cacheSet, cacheStats, cacheClear,
  historyAdd, historyList, historyDeleteBefore, cacheDeleteBefore,
  resourceAdd, resourceGet, resourceUpdate, resourceDelete, resourceCount, resourceExists, resourceSearch,
  submitAdd, submitGet, submitList, submitReview,
  crawlerSourceList, crawlerSourceAdd, crawlerSourceUpdate, crawlerSourceDelete,
  crawlerRuleList, crawlerRuleAdd, crawlerRuleUpdate, crawlerRuleDelete,
  importLogAdd, importLogList, reportAdd, reportList,
  keywordUpsert, keywordEnsure, keywordList, keywordUpdate, keywordDelete,
  transferTop, aiSummaryAdd, aiSummaryList, ensureTable,
  tableCount, ensureSeed, init, status, close,
};
