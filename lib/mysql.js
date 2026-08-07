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

// ---- cookies（替代 cookies.enc；多账号：provider 非唯一，同 provider 可多行）----
async function cookieGet(provider) {
  var rows = await query("SELECT encrypted_value, is_valid FROM cookies WHERE provider=? ORDER BY id LIMIT 1", [provider]);
  return rows[0] || null;
}
async function cookieSet(provider, encValue, isValid) {
  // 兼容旧调用：同 provider 有账号则更新第一个，否则新增
  var rows = await query("SELECT id FROM cookies WHERE provider=? ORDER BY id LIMIT 1", [provider]);
  if (rows.length) {
    await execute("UPDATE cookies SET encrypted_value=?, is_valid=? WHERE id=?", [encValue, isValid ? 1 : 0, rows[0].id]);
  } else {
    await execute("INSERT INTO cookies (provider, encrypted_value, is_valid) VALUES (?,?,?)", [provider, encValue, isValid ? 1 : 0]);
  }
}
async function cookieList() {
  return query(
    "SELECT id, provider, name, encrypted_value, is_valid, enabled, last_tested_at FROM cookies ORDER BY provider, id");
}
async function cookieAdd(provider, encValue, name) {
  await execute("INSERT INTO cookies (provider, name, encrypted_value, is_valid, enabled) VALUES (?,?,?,0,1)",
    [provider, name || "", encValue]);
}
async function cookieUpdate(id, fields) {
  var allowed = ["name", "enabled", "is_valid", "encrypted_value", "last_tested_at"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k]);
  }
  if (!sets.length) return;
  params.push(id);
  await execute("UPDATE cookies SET " + sets.join(",") + ", updated_at=NOW() WHERE id=?", params);
}
async function cookieDelete(id) {
  await execute("DELETE FROM cookies WHERE id=?", [id]);
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
    "SELECT id, original_url, new_url, pwd, type, title, success, created_at FROM transfer_history ORDER BY created_at DESC, id DESC LIMIT ?",
    [Math.min(limit || 50, 200)]);
  return rows.map(function (r) {
    return {
      id: r.id, originalUrl: r.original_url, newUrl: r.new_url, pwd: r.pwd || "",
      type: r.type, title: r.title || "", success: !!r.success,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    };
  });
}
async function historyDelete(ids) {
  if (!ids || !ids.length) return;
  var arr = ids.map(Number).filter(function (n) { return n > 0; });
  if (!arr.length) return;
  await execute("DELETE FROM transfer_history WHERE id IN (" + arr.map(function () { return "?"; }).join(",") + ")", arr);
}
async function historyClear() {
  await execute("DELETE FROM transfer_history");
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
  // 兼容旧语义：每 provider 取第一个启用账号（未启用优先排除，全禁用则取第一个）
  var rows = await query("SELECT provider, encrypted_value, enabled FROM cookies ORDER BY enabled DESC, id");
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i].provider;
    if (out[p] !== undefined) continue;
    if (!rows[i].enabled) {
      var anyEnabled = rows.some(function (r) { return r.provider === p && r.enabled; });
      if (anyEnabled) continue;
    }
    out[p] = rows[i].encrypted_value;
  }
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
    "INSERT INTO resources (title, url, password, disk_type, category, tags, description, thumbnail, file_name, file_size, source, source_id, status, link_valid, check_message, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
    [rec.title, rec.url, rec.password || "", rec.disk_type || "quark", rec.category || "", rec.tags || "",
      rec.description || null, rec.thumbnail || "", rec.file_name || "", rec.file_size || "", rec.source || "manual",
      rec.source_id || "", rec.status === undefined ? 1 : rec.status, rec.link_valid === undefined ? null : (rec.link_valid ? 1 : 0), rec.check_message || ""]);
  return r.insertId;
}
async function resourceGet(id) {
  var rows = await query("SELECT * FROM resources WHERE id=?", [id]);
  return rows[0] || null;
}
async function resourceUpdate(id, fields) {
  var allowed = ["title","url","password","disk_type","category","tags","description","thumbnail","file_name","file_size",
    "status","link_valid","check_message","last_checked_at","check_fail_count","optimized","optimized_at"];
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
// 批量删除（资源管理多选删）；ids 数组，含 submitted_resources 的引用清理？——不需要，资源删除不影响提交记录
async function resourceDeleteBatch(ids) {
  if (!ids || !ids.length) return 0;
  var arr = ids.map(Number).filter(function (n) { return n > 0; });
  if (!arr.length) return 0;
  var r = await execute("DELETE FROM resources WHERE id IN (" + arr.map(function () { return "?"; }).join(",") + ")", arr);
  return r.affectedRows || arr.length;
}
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
  if (opt.created_from) { where.push("created_at>=?"); params.push(opt.created_from); }
  if (opt.created_to) { where.push("created_at<=?"); params.push(opt.created_to + " 23:59:59"); }
  // 链接状态筛选：valid 有效 / invalid 失效 / notchecked 未检测 / expired 超期未测（默认 3 天）
  if (opt.link_status === "valid") { where.push("link_valid=1"); }
  else if (opt.link_status === "invalid") { where.push("link_valid=0"); }
  else if (opt.link_status === "notchecked") { where.push("last_checked_at IS NULL"); }
  else if (opt.link_status === "expired") { where.push("last_checked_at IS NOT NULL AND last_checked_at < DATE_SUB(NOW(), INTERVAL 3 DAY)"); }
  // 前台本地搜索：排除已确认失效的资源（未检测/有效的都展示）
  if (opt.exclude_invalid) { where.push("(link_valid IS NULL OR link_valid=1)"); }
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

// ---- scheduled_tasks（定时任务中心）----
async function taskList() {
  return query("SELECT * FROM scheduled_tasks ORDER BY id DESC");
}
async function taskGetById(id) {
  var rows = await query("SELECT * FROM scheduled_tasks WHERE id=?", [id]);
  return rows[0] || null;
}
async function taskAdd(rec) {
  var r = await execute(
    "INSERT INTO scheduled_tasks (task_name, task_type, interval_sec, task_config, status) VALUES (?,?,?,?,?)",
    [rec.task_name || "", rec.task_type, rec.interval_sec || 3600,
      rec.task_config ? JSON.stringify(rec.task_config) : null,
      rec.status === undefined ? 1 : rec.status]);
  return r.insertId;
}
async function taskUpdate(id, fields) {
  var allowed = ["task_name", "task_type", "interval_sec", "task_config", "status", "next_run_at"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    if (k === "task_config") { sets.push(k + "=?"); params.push(JSON.stringify(fields[k])); continue; }
    sets.push(k + "=?");
    params.push(fields[k] === null ? null : fields[k]);
  }
  if (!sets.length) return;
  params.push(id);
  await execute("UPDATE scheduled_tasks SET " + sets.join(",") + " WHERE id=?", params);
}
async function taskDelete(id) { await execute("DELETE FROM scheduled_tasks WHERE id=?", [id]); }
async function taskLogList(taskId, limit) {
  if (taskId) return query("SELECT * FROM task_logs WHERE task_id=? ORDER BY id DESC LIMIT ?", [taskId, Math.min(limit || 50, 200)]);
  return query("SELECT * FROM task_logs ORDER BY id DESC LIMIT ?", [Math.min(limit || 50, 200)]);
}

// ---- custom_scripts（自定义脚本：head 前端注入 / task 定时任务）----
async function scriptList(type) {
  var sql = "SELECT * FROM custom_scripts";
  var params = [];
  if (type) { sql += " WHERE script_type=?"; params.push(type); }
  sql += " ORDER BY position ASC, id DESC";
  return query(sql, params);
}
async function scriptGetByType(type) {
  return query("SELECT * FROM custom_scripts WHERE script_type=? AND enabled=1 ORDER BY position ASC, id DESC LIMIT 20", [type]);
}
async function scriptSave(rec) {
  if (rec.id) {
    await execute("UPDATE custom_scripts SET script_name=?, script_type=?, script_code=?, position=?, enabled=? WHERE id=?",
      [rec.script_name || "", rec.script_type || "head", rec.script_code || "", rec.position || 0, rec.enabled === undefined ? 1 : rec.enabled, rec.id]);
    return rec.id;
  }
  var r = await execute("INSERT INTO custom_scripts (script_name, script_type, script_code, position, enabled) VALUES (?,?,?,?,?)",
    [rec.script_name || "", rec.script_type || "head", rec.script_code || "", rec.position || 0, rec.enabled === undefined ? 1 : rec.enabled]);
  return r.insertId;
}
async function scriptDelete(id) { await execute("DELETE FROM custom_scripts WHERE id=?", [id]); }

// ---- search_keywords（热搜关键词）----
// 采集：INSERT ... ON DUPLICATE KEY UPDATE search_count+1（uk_keyword 唯一键）
async function keywordUpsert(kw) {
  await execute(
    "INSERT INTO search_keywords (keyword, search_count, is_hot, sort_order, status, source) VALUES (?,1,0,0,1,'') " +
    "ON DUPLICATE KEY UPDATE search_count=search_count+1",
    [kw]);
}
// 手动新增/置热：已存在则更新 is_hot/sort_order/status/source/search_count（热度以用户输入为准），不存在则插入
async function keywordEnsure(kw, fields) {
  var sc = parseInt(fields.search_count, 10);
  var scVal = isNaN(sc) ? 0 : sc;
  await execute(
    "INSERT INTO search_keywords (keyword, search_count, is_hot, sort_order, status, source) VALUES (?,?,?,?,?,?) " +
    "ON DUPLICATE KEY UPDATE is_hot=VALUES(is_hot), sort_order=VALUES(sort_order), status=VALUES(status), source=VALUES(source), search_count=VALUES(search_count)",
    [kw, scVal, fields.is_hot ? 1 : 0, fields.sort_order || 0, fields.status === undefined ? 1 : fields.status, fields.source || ""]);
}
async function keywordList(limit, onlyHot) {
  var w = onlyHot ? "WHERE status=1 AND (is_hot=1 OR search_count>0)" : "WHERE status=1";
  // 自动按热度排名（search_count 降序），不再按手动置顶/来源/排序号
  return query(
    "SELECT id, keyword, search_count, is_hot, sort_order, status, source FROM search_keywords " + w +
    " ORDER BY search_count DESC, id DESC LIMIT ?",
    [Math.min(limit || 50, 100)]);
}
// 采集任务用：upsert 且不累计（采集词固定 search_count=0，靠排序位次展示）
async function keywordCollect(kw, source) {
  await execute(
    "INSERT INTO search_keywords (keyword, search_count, is_hot, sort_order, status, source) VALUES (?,0,0,0,1,?) " +
    "ON DUPLICATE KEY UPDATE source=VALUES(source), status=1",
    [kw, source]);
}
async function keywordUpdate(id, fields) {
  var allowed = ["keyword", "is_hot", "sort_order", "status", "search_count"];
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

// ---- 资源热度榜：resources 表驱动（转存过的排前，其余按最新入库补位）----
// 标题全部来自 resources（与本地搜索同源，点击跳转必能搜到）
async function resourceHot(limit) {
  var rows = await query(
    "SELECT r.title, r.url, r.disk_type, r.category, r.created_at, COUNT(t.id) AS cnt " +
    "FROM resources r LEFT JOIN transfer_history t ON t.original_url = r.url AND t.success = 1 " +
    "WHERE r.status = 1 GROUP BY r.id ORDER BY cnt DESC, r.created_at DESC LIMIT ?",
    [Math.min(limit || 10, 50)]);
  return rows;
}

// ---- 资源热榜手动配置表（hot_rankings）----
// 入榜（resource_id 已存在则刷新快照；不存在则插入，sort_order 取当前最大+1）
async function hotRankAdd(resource) {
  var r = resource || {};
  var maxRow = await query("SELECT COALESCE(MAX(sort_order),0) AS m FROM hot_rankings");
  var next = ((maxRow && maxRow[0] && maxRow[0].m) || 0) + 1;
  await execute(
    "INSERT INTO hot_rankings (resource_id, title, url, disk_type, category, sort_order, status) VALUES (?,?,?,?,?,?,1) " +
    "ON DUPLICATE KEY UPDATE title=VALUES(title), url=VALUES(url), disk_type=VALUES(disk_type), category=VALUES(category), status=1",
    [parseInt(r.id, 10) || 0, String(r.title || ""), String(r.url || ""), String(r.disk_type || ""), String(r.category || ""), next]);
  return next;
}
// 热榜列表（管理 + 前台共用）：按 sort_order, id 升序
async function hotRankList() {
  return query("SELECT * FROM hot_rankings WHERE status=1 ORDER BY sort_order ASC, id ASC LIMIT 200");
}
// 拖拽排序：ids = [id1, id2, ...] 按序写 sort_order=1..N
async function hotRankSaveSort(ids) {
  var list = Array.isArray(ids) ? ids : [];
  for (var i = 0; i < list.length; i++) {
    await execute("UPDATE hot_rankings SET sort_order=? WHERE id=?", [i + 1, parseInt(list[i], 10) || 0]);
  }
  return list.length;
}
// 移除热榜
async function hotRankRemove(id) {
  await execute("DELETE FROM hot_rankings WHERE id=?", [parseInt(id, 10) || 0]);
}
// 是否已入榜（返回 resource_id 集合）
async function hotRankedIds() {
  var rows = await query("SELECT resource_id FROM hot_rankings");
  return (rows || []).map(function (r) { return r.resource_id; });
}

// ---- 失效反馈（link_feedback）----
// 提交（同资源已有待处理反馈则不重复插入）
async function feedbackAdd(rec) {
  var dup = await query("SELECT id FROM link_feedback WHERE resource_id=? AND status=0 LIMIT 1", [parseInt(rec.resource_id, 10) || 0]);
  if (dup.length) return dup[0].id;
  var r = await execute(
    "INSERT INTO link_feedback (resource_id, title, url, disk_type, status) VALUES (?,?,?,?,0)",
    [parseInt(rec.resource_id, 10) || 0, String(rec.title || ""), String(rec.url || ""), String(rec.disk_type || "")]);
  return r.insertId;
}
async function feedbackList(status) {
  var w = (status !== undefined && status !== null && status !== "") ? "WHERE status=?" : "";
  var params = (status !== undefined && status !== null && status !== "") ? [status] : [];
  return query("SELECT * FROM link_feedback " + w + " ORDER BY status ASC, id DESC LIMIT 200", params);
}
async function feedbackUpdate(id, fields) {
  var allowed = ["status", "admin_remark"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k]);
  }
  if (!sets.length) return;
  params.push(parseInt(id, 10) || 0);
  await execute("UPDATE link_feedback SET " + sets.join(",") + ", updated_at=NOW() WHERE id=?", params);
}
async function feedbackDelete(id) {
  await execute("DELETE FROM link_feedback WHERE id=?", [parseInt(id, 10) || 0]);
}

// ---- 资源统计（首页真实收录数：按 disk_type）----
async function resourceStats() {
  var byType = await query("SELECT disk_type, COUNT(*) AS c FROM resources WHERE status=1 GROUP BY disk_type");
  var total = 0, map = {};
  (byType || []).forEach(function (r) { map[r.disk_type] = r.c; total += r.c; });
  var validRows = await query("SELECT COUNT(*) AS c FROM resources WHERE status=1 AND link_valid=1");
  return { total: total, byType: map, valid: validRows[0].c };
}
// 按采集源统计入库数（TG 采集页源列表用）
async function resourceCountBySource() {
  var rows = await query("SELECT source_id, COUNT(*) AS c FROM resources WHERE status=1 AND source_id IS NOT NULL GROUP BY source_id");
  var map = {};
  (rows || []).forEach(function (r) { map[String(r.source_id)] = r.c; });
  return map;
}
// 仪表盘：热搜词数 + 转存统计（总数/今日）
async function keywordCount() {
  var rows = await query("SELECT COUNT(*) AS c FROM search_keywords WHERE status=1");
  return rows[0].c;
}
async function transferStats() {
  var rows = await query(
    "SELECT COUNT(*) AS total, SUM(success=1 AND created_at>=CURDATE()) AS today FROM transfer_history");
  return { total: rows[0].total || 0, today: parseInt(rows[0].today, 10) || 0 };
}

// ---- categories（资源分类字典）----
async function categoryList() {
  // sort_order=0（补种/未设置）排最后，其余按 sort_order 升序
  return query("SELECT * FROM categories ORDER BY (sort_order=0) ASC, sort_order ASC, id ASC");
}
async function categoryAdd(rec) {
  var r = await execute(
    "INSERT INTO categories (name, sort_order, status) VALUES (?,?,?)",
    [rec.name, rec.sort_order || 0, rec.status === undefined ? 1 : rec.status]);
  return r.insertId;
}
async function categoryUpdate(id, fields) {
  var allowed = ["name", "sort_order", "status"];
  var sets = [], params = [];
  for (var k in fields) {
    if (allowed.indexOf(k) === -1 || fields[k] === undefined) continue;
    sets.push(k + "=?");
    params.push(fields[k]);
  }
  if (!sets.length) return;
  params.push(id);
  await execute("UPDATE categories SET " + sets.join(",") + ", updated_at=NOW() WHERE id=?", params);
}
async function categoryDelete(id) { await execute("DELETE FROM categories WHERE id=?", [id]); }
// 每分类的资源/采集源引用计数（分类管理页展示）
async function categoryRefCounts() {
  var res = await query("SELECT category, COUNT(*) AS c FROM resources WHERE status=1 AND category<>'' GROUP BY category");
  var src = await query("SELECT category, COUNT(*) AS c FROM crawler_sources WHERE category<>'' GROUP BY category");
  var map = {};
  (res || []).forEach(function (r) { map[r.category] = map[r.category] || { res: 0, src: 0 }; map[r.category].res = r.c; });
  (src || []).forEach(function (r) { map[r.category] = map[r.category] || { res: 0, src: 0 }; map[r.category].src = r.c; });
  return map;
}
// 分类改名联动：resources / crawler_sources / submitted_resources 同步旧名 → 新名
async function categoryRenameRefs(oldName, newName) {
  await execute("UPDATE resources SET category=? WHERE category=?", [newName, oldName]);
  await execute("UPDATE crawler_sources SET category=? WHERE category=?", [newName, oldName]);
  await execute("UPDATE submitted_resources SET category=? WHERE category=?", [newName, oldName]);
}
// 删除分类：清空资源/源上的分类引用（置空而非删除数据）
async function categoryClearRefs(name) {
  await execute("UPDATE resources SET category='' WHERE category=?", [name]);
  await execute("UPDATE crawler_sources SET category='' WHERE category=?", [name]);
  await execute("UPDATE submitted_resources SET category='' WHERE category=?", [name]);
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

// 配置变更后重连：关闭连接池 → 重新加载 db.config.json → ping 验证
async function reconnect() {
  await close();
  cfg = loadConfig();
  return status();
}

// 资源导出（全量，无分页上限，最多 5000 条）：筛选条件同 resourceSearch
async function resourceExportAll(opt) {
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
  if (opt.created_from) { where.push("created_at>=?"); params.push(opt.created_from); }
  if (opt.created_to) { where.push("created_at<=?"); params.push(opt.created_to + " 23:59:59"); }
  if (opt.link_status === "valid") { where.push("link_valid=1"); }
  else if (opt.link_status === "invalid") { where.push("link_valid=0"); }
  else if (opt.link_status === "notchecked") { where.push("last_checked_at IS NULL"); }
  else if (opt.link_status === "expired") { where.push("last_checked_at IS NOT NULL AND last_checked_at < DATE_SUB(NOW(), INTERVAL 3 DAY)"); }
  var w = where.length ? "WHERE " + where.join(" AND ") : "";
  return query("SELECT * FROM resources " + w + " ORDER BY created_at DESC, id DESC LIMIT 5000", params);
}

// ---- 启动初始化：ping + 种子数据 ----
async function ensureTable() {
  // hot_rankings 表（资源热榜手动配置：入榜资源 + 拖拽排序，独立于资源表/转存流水）
  await execute(
    "CREATE TABLE IF NOT EXISTS hot_rankings (" +
    "id INT PRIMARY KEY AUTO_INCREMENT, " +
    "resource_id INT NOT NULL DEFAULT 0, " +
    "title VARCHAR(500) NOT NULL DEFAULT '', " +
    "url VARCHAR(1000) NOT NULL DEFAULT '', " +
    "disk_type VARCHAR(20) NOT NULL DEFAULT '', " +
    "category VARCHAR(64) NOT NULL DEFAULT '', " +
    "sort_order INT NOT NULL DEFAULT 0, " +
    "status TINYINT(1) NOT NULL DEFAULT 1, " +
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, " +
    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
    "UNIQUE KEY uk_resource (resource_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  // link_feedback 表（用户失效反馈：本地资源打开弹框提交，后台审核处理）
  await execute(
    "CREATE TABLE IF NOT EXISTS link_feedback (" +
    "id INT PRIMARY KEY AUTO_INCREMENT, " +
    "resource_id INT NOT NULL DEFAULT 0, " +
    "title VARCHAR(500) NOT NULL DEFAULT '', " +
    "url VARCHAR(1000) NOT NULL DEFAULT '', " +
    "disk_type VARCHAR(20) NOT NULL DEFAULT '', " +
    "status TINYINT(1) NOT NULL DEFAULT 0, " +
    "admin_remark VARCHAR(500) NOT NULL DEFAULT '', " +
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, " +
    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  // categories 表（资源分类字典，幂等建表 + 从现有数据自动补种）
  await execute(
    "CREATE TABLE IF NOT EXISTS categories (" +
    "id INT PRIMARY KEY AUTO_INCREMENT, " +
    "name VARCHAR(64) NOT NULL DEFAULT '', " +
    "sort_order INT NOT NULL DEFAULT 0, " +
    "status TINYINT(1) NOT NULL DEFAULT 1, " +
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, " +
    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
    "UNIQUE KEY uk_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  // 旧表补 status/updated_at 列（8-03 schema 无 status），幂等
  try {
    var catCols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='categories' AND COLUMN_NAME='status'",
      [cfg.database]);
    if (!catCols.length) {
      await execute("ALTER TABLE categories ADD COLUMN status TINYINT(1) NOT NULL DEFAULT 1 AFTER sort_order");
      console.log("[mysql] categories 增加 status 列");
    }
  } catch (e) { console.error("[mysql] categories status 列检查失败（忽略）:", e.message); }
  try {
    var catUCols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='categories' AND COLUMN_NAME='updated_at'",
      [cfg.database]);
    if (!catUCols.length) {
      await execute("ALTER TABLE categories ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");
      console.log("[mysql] categories 增加 updated_at 列");
    }
  } catch (e) { console.error("[mysql] categories updated_at 列检查失败（忽略）:", e.message); }
  try {
    await execute(
      "INSERT IGNORE INTO categories (name, sort_order) " +
      "SELECT category, 0 FROM resources WHERE category<>'' GROUP BY category");
  } catch (e) { console.error("[mysql] categories 自动补种失败（忽略）:", e.message); }
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
  // search_keywords.source 列（采集词标记：douban 等），幂等 ALTER
  try {
    var cols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='search_keywords' AND COLUMN_NAME='source'",
      [cfg.database]);
    if (!cols.length) {
      await execute("ALTER TABLE search_keywords ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT '' AFTER sort_order");
      console.log("[mysql] search_keywords 增加 source 列（采集词标记）");
    }
  } catch (e) { console.error("[mysql] source 列检查失败（忽略）:", e.message); }
  // cookies 表多账号迁移（provider 单值 → id 自增 + name/enabled），幂等
  try {
    var ccols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='cookies' AND COLUMN_NAME='id'",
      [cfg.database]);
    if (!ccols.length) {
      await execute(
        "ALTER TABLE cookies DROP PRIMARY KEY, " +
        "ADD COLUMN id BIGINT AUTO_INCREMENT PRIMARY KEY FIRST, " +
        "ADD COLUMN name VARCHAR(32) NOT NULL DEFAULT '' AFTER provider, " +
        "ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER is_valid, " +
        "ADD INDEX idx_provider (provider)");
      console.log("[mysql] cookies 表迁移为多账号结构（id/name/enabled）");
    }
  } catch (e) { console.error("[mysql] cookies 迁移失败（忽略）:", e.message); }
  // resources.thumbnail 列（采集封面图 URL），幂等 ALTER
  try {
    var tcols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='resources' AND COLUMN_NAME='thumbnail'",
      [cfg.database]);
    if (!tcols.length) {
      await execute("ALTER TABLE resources ADD COLUMN thumbnail VARCHAR(512) DEFAULT '' AFTER description");
      console.log("[mysql] resources 增加 thumbnail 列（封面图）");
    }
  } catch (e) { console.error("[mysql] thumbnail 列检查失败（忽略）:", e.message); }
  // resources.optimized / optimized_at 列（AI 资源优化状态，防重复优化），幂等 ALTER
  try {
    var ocols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='resources' AND COLUMN_NAME='optimized'",
      [cfg.database]);
    if (!ocols.length) {
      await execute("ALTER TABLE resources ADD COLUMN optimized TINYINT(1) NOT NULL DEFAULT 0 AFTER tags");
      await execute("ALTER TABLE resources ADD COLUMN optimized_at DATETIME NULL AFTER optimized");
      console.log("[mysql] resources 增加 optimized/optimized_at 列（AI 优化状态）");
    }
  } catch (e) { console.error("[mysql] optimized 列检查失败（忽略）:", e.message); }

  // resources 链接检测复合索引（链接状态筛选/超期轮转加速），幂等
  try {
    var idxs = await query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='resources' AND INDEX_NAME='idx_link_check'",
      [cfg.database]);
    if (!idxs.length) {
      await execute("ALTER TABLE resources ADD INDEX idx_link_check (link_valid, last_checked_at)");
      console.log("[mysql] resources 增加 idx_link_check 索引（链接检测筛选）");
    }
  } catch (e) { console.error("[mysql] idx_link_check 索引检查失败（忽略）:", e.message); }

  // crawl_keywords 采集词库表（8-07：采集词库 = site 采集 + 盘搜站爬取的公共词源）
  await execute(
    "CREATE TABLE IF NOT EXISTS crawl_keywords (" +
    "id INT PRIMARY KEY AUTO_INCREMENT, " +
    "keyword VARCHAR(128) NOT NULL DEFAULT '', " +
    "category VARCHAR(32) NOT NULL DEFAULT '', " +
    "source VARCHAR(16) NOT NULL DEFAULT 'manual', " +
    "weight INT NOT NULL DEFAULT 10, " +
    "status TINYINT(1) NOT NULL DEFAULT 1, " +
    "last_crawled_at DATETIME NULL, " +
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, " +
    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
    "UNIQUE KEY uk_keyword (keyword)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  // douban_subjects 豆瓣资料库表（8-07：SeedHub/豆瓣采集的影音书籍资料，resources.douban_id 关联）
  await execute(
    "CREATE TABLE IF NOT EXISTS douban_subjects (" +
    "id INT PRIMARY KEY AUTO_INCREMENT, " +
    "douban_id BIGINT NOT NULL DEFAULT 0, " +
    "seed_id INT NOT NULL DEFAULT 0, " +
    "title VARCHAR(255) NOT NULL DEFAULT '', " +
    "original_title VARCHAR(255) NOT NULL DEFAULT '', " +
    "year INT NOT NULL DEFAULT 0, " +
    "media_type VARCHAR(16) NOT NULL DEFAULT '', " +
    "region VARCHAR(255) NOT NULL DEFAULT '', " +
    "languages VARCHAR(255) NOT NULL DEFAULT '', " +
    "directors VARCHAR(500) NOT NULL DEFAULT '', " +
    "writers VARCHAR(500) NOT NULL DEFAULT '', " +
    "actors VARCHAR(1000) NOT NULL DEFAULT '', " +
    "genres VARCHAR(255) NOT NULL DEFAULT '', " +
    "rating DECIMAL(3,1) NOT NULL DEFAULT 0, " +
    "rating_count INT NOT NULL DEFAULT 0, " +
    "release_date VARCHAR(64) NOT NULL DEFAULT '', " +
    "episodes INT NOT NULL DEFAULT 0, " +
    "duration VARCHAR(64) NOT NULL DEFAULT '', " +
    "summary MEDIUMTEXT NULL, " +
    "poster VARCHAR(512) NOT NULL DEFAULT '', " +
    "douban_url VARCHAR(255) NOT NULL DEFAULT '', " +
    "seed_url VARCHAR(255) NOT NULL DEFAULT '', " +
    "source VARCHAR(16) NOT NULL DEFAULT 'seeduck', " +
    "status TINYINT(1) NOT NULL DEFAULT 1, " +
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, " +
    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
    "UNIQUE KEY uk_douban (douban_id), KEY idx_title (title)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  // resources.douban_id 列（资源 ↔ 豆瓣资料关联，前台显示海报/评分/简介），幂等 ALTER
  try {
    var dcols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='resources' AND COLUMN_NAME='douban_id'",
      [cfg.database]);
    if (!dcols.length) {
      await execute("ALTER TABLE resources ADD COLUMN douban_id BIGINT NOT NULL DEFAULT 0 AFTER thumbnail");
      await execute("ALTER TABLE resources ADD INDEX idx_douban (douban_id)");
      console.log("[mysql] resources 增加 douban_id 列（豆瓣资料关联）");
    }
  } catch (e) { console.error("[mysql] resources douban_id 列检查失败（忽略）:", e.message); }
  // scheduled_tasks.running_at/running_by 列（任务实例锁：本地+NAS 共享同一 MySQL，防任务重叠执行），幂等 ALTER
  try {
    var rtCols = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='scheduled_tasks' AND COLUMN_NAME='running_at'",
      [cfg.database]);
    if (!rtCols.length) {
      await execute("ALTER TABLE scheduled_tasks ADD COLUMN running_at DATETIME NULL AFTER next_run_at");
      await execute("ALTER TABLE scheduled_tasks ADD COLUMN running_by VARCHAR(32) NOT NULL DEFAULT '' AFTER running_at");
      console.log("[mysql] scheduled_tasks 增加 running_at/running_by 列（任务实例锁）");
    }
  } catch (e) { console.error("[mysql] running_at 列检查失败（忽略）:", e.message); }
}

async function ensureSeed() {
  var rows = await query("SELECT COUNT(*) AS c FROM site_config");
  if (rows[0].c === 0) {
    var defaults = [
      ["pansouBase", "https://pansou.makepic.online", "盘搜 API 地址"],
      ["quarkDir", "0", "夸克转存目标目录 fid"],
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

  // 内置任务种子（幂等：先查后插，避免 INSERT IGNORE 无唯一键时重复）
  var seedTasks = [
    ["转存资源清理", "cleanup", 86400, { time: "03:00", dryRun: false }],
    ["豆瓣热词采集", "douban_hotwords", 86400, { time: "08:00", top: 10 }],
    ["热门推荐预热", "trending_prewarm", 1800, {}],
    ["资源 AI 优化", "optimize_resources", 86400, { time: "02:30", batch_size: 100 }],
    ["资源链接重测", "check_resources", 86400, { time: "03:30", batch_size: 3000, days: 3, concurrency: 20 }],
    ["资源采集流水线", "resource_collect", 86400, { time: "03:00", daily_limit: 200 }],
  ];
  for (var ti = 0; ti < seedTasks.length; ti++) {
    try {
      var existing = await query("SELECT id FROM scheduled_tasks WHERE task_type=? LIMIT 1", [seedTasks[ti][1]]);
      if (existing.length === 0) {
        await execute(
          "INSERT INTO scheduled_tasks (task_name, task_type, interval_sec, task_config, status) VALUES (?,?,?,?,1)",
          [seedTasks[ti][0], seedTasks[ti][1], seedTasks[ti][2], seedTasks[ti][3]]);
      }
    } catch (e) { console.error("[mysql] 任务种子失败:", seedTasks[ti][1], e.message); }
  }
  // 清理历史重复种子（旧版 INSERT IGNORE 无唯一键造成的），每类型只保留最新一条
  // 注意：仅对内置种子类型去重（cleanup/douban_hotwords/trending_prewarm）；crawl_source/script 是每源/每脚本一条，允许多条，绝不能删
  var seedTypes = {};
  seedTasks.forEach(function (t) { seedTypes[t[1]] = 1; });
  try {
    var dupTypes = await query("SELECT task_type, COUNT(*) c FROM scheduled_tasks GROUP BY task_type HAVING c>1");
    for (var di = 0; di < (dupTypes || []).length; di++) {
      if (!seedTypes[dupTypes[di].task_type]) continue; // 非内置种子类型跳过
      var rows2 = await query("SELECT id FROM scheduled_tasks WHERE task_type=? ORDER BY id ASC", [dupTypes[di].task_type]);
      for (var dj = 0; dj < rows2.length - 1; dj++) {
        await execute("DELETE FROM scheduled_tasks WHERE id=?", [rows2[dj].id]);
      }
    }
  } catch (e) { console.error("[mysql] 任务去重失败:", e.message); }
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

// ============ 采集词库 crawl_keywords（8-07）============
async function keywordCrawlerList(opt) {
  opt = opt || {};
  var where = [], args = [];
  if (opt.kw) { where.push("keyword LIKE ?"); args.push("%" + opt.kw + "%"); }
  if (opt.category) { where.push("category=?"); args.push(opt.category); }
  if (opt.source) { where.push("source=?"); args.push(opt.source); }
  if (opt.status !== undefined && opt.status !== "") { where.push("status=?"); args.push(Number(opt.status)); }
  var w = where.length ? " WHERE " + where.join(" AND ") : "";
  var page = parseInt(opt.page, 10) || 1, size = parseInt(opt.size, 10) || 20;
  var cnt = await query("SELECT COUNT(*) c FROM crawl_keywords" + w, args);
  var rows = await query("SELECT * FROM crawl_keywords" + w + " ORDER BY status DESC, weight DESC, id DESC LIMIT " + ((page - 1) * size) + "," + size, args);
  return { items: rows || [], total: cnt[0].c, page: page };
}
async function keywordCrawlerAdd(rec) {
  var r = await execute(
    "INSERT IGNORE INTO crawl_keywords (keyword, category, source, weight, status) VALUES (?,?,?,?,?)",
    [rec.keyword, rec.category || "", rec.source || "manual", parseInt(rec.weight, 10) || 10, rec.status === 0 ? 0 : 1]);
  return { ok: true, inserted: r && r.affectedRows > 0 };
}
async function keywordCrawlerImport(list) {
  var inserted = 0, skipped = 0;
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (!it || !it.keyword) { skipped++; continue; }
    var r = await keywordCrawlerAdd(it);
    if (r.inserted) inserted++; else skipped++;
  }
  return { inserted: inserted, skipped: skipped };
}
async function keywordCrawlerUpdate(id, fields) {
  if (!fields || !Object.keys(fields).length) return;
  await execute("UPDATE crawl_keywords SET " + Object.keys(fields).map(function (k) { return k + "=?"; }).join(",") + " WHERE id=?",
    Object.keys(fields).map(function (k) { return fields[k]; }).concat([id]));
}
async function keywordCrawlerDelete(id) { await execute("DELETE FROM crawl_keywords WHERE id=?", [id]); }
async function keywordCrawlerBatchSet(ids, status) {
  if (!ids || !ids.length) return 0;
  var r = await execute("UPDATE crawl_keywords SET status=? WHERE id IN (" + ids.map(function () { return "?"; }).join(",") + ")",
    [status ? 1 : 0].concat(ids));
  return r && r.affectedRows || 0;
}
async function keywordCrawlerStats() {
  var total = await query("SELECT COUNT(*) c FROM crawl_keywords");
  var active = await query("SELECT COUNT(*) c FROM crawl_keywords WHERE status=1");
  var pending = await query("SELECT COUNT(*) c FROM crawl_keywords WHERE status=1 AND (last_crawled_at IS NULL)");
  var bySource = await query("SELECT source, COUNT(*) c FROM crawl_keywords GROUP BY source");
  var byCategory = await query("SELECT category, COUNT(*) c FROM crawl_keywords GROUP BY category ORDER BY c DESC LIMIT 20");
  return {
    total: total[0].c, active: active[0].c, pending: pending[0].c,
    bySource: bySource || [], byCategory: byCategory || [],
  };
}
// 采集任务取词：启用 + 未采集优先 + 权重降序 + 已采集轮换（last_crawled_at ASC）
async function keywordCrawlerTake(limit, category) {
  limit = parseInt(limit, 10) || 100;
  var where = "status=1";
  var args = [];
  if (category) { where += " AND category=?"; args.push(category); }
  var rows = await query(
    "SELECT id, keyword, category, weight FROM crawl_keywords WHERE " + where +
    " ORDER BY (last_crawled_at IS NULL) DESC, weight DESC, last_crawled_at ASC, id ASC LIMIT " + limit, args);
  return rows || [];
}
async function keywordCrawlerMarkCrawled(ids) {
  if (!ids || !ids.length) return;
  await execute("UPDATE crawl_keywords SET last_crawled_at=NOW() WHERE id IN (" + ids.map(function () { return "?"; }).join(",") + ")", ids);
}

// ============ 豆瓣资料 douban_subjects（8-07）============
async function doubanList(opt) {
  opt = opt || {};
  var where = [], args = [];
  if (opt.kw) { where.push("(title LIKE ? OR original_title LIKE ?)"); args.push("%" + opt.kw + "%", "%" + opt.kw + "%"); }
  if (opt.media_type) { where.push("media_type=?"); args.push(opt.media_type); }
  if (opt.rating_min !== undefined && opt.rating_min !== "") { where.push("rating>=?"); args.push(Number(opt.rating_min)); }
  if (opt.unmatched === "1") { where.push("douban_id NOT IN (SELECT douban_id FROM douban_subjects WHERE id IN (SELECT douban_id FROM resources WHERE douban_id>0))"); }
  var w = where.length ? " WHERE " + where.join(" AND ") : "";
  var page = parseInt(opt.page, 10) || 1, size = parseInt(opt.size, 10) || 20;
  var cnt = await query("SELECT COUNT(*) c FROM douban_subjects" + w, args);
  var rows = await query("SELECT * FROM douban_subjects" + w + " ORDER BY id DESC LIMIT " + ((page - 1) * size) + "," + size, args);
  return { items: rows || [], total: cnt[0].c, page: page };
}
async function doubanGet(id) {
  var rows = await query("SELECT * FROM douban_subjects WHERE id=? LIMIT 1", [id]);
  return rows[0] || null;
}
async function doubanGetByDoubanId(doubanId, seedId) {
  var rows = await query("SELECT id FROM douban_subjects WHERE (douban_id=? AND ?<>0) OR (douban_id=0 AND seed_id=? AND ?<>0) LIMIT 1",
    [doubanId || 0, doubanId || 0, seedId || 0, seedId || 0]);
  return rows[0] || null;
}
async function doubanUpsert(rec) {
  await execute(
    "INSERT INTO douban_subjects (douban_id, seed_id, title, original_title, year, media_type, region, languages, directors, writers, actors, genres, rating, rating_count, release_date, episodes, duration, summary, poster, douban_url, seed_url, source) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
    "ON DUPLICATE KEY UPDATE title=VALUES(title), seed_id=VALUES(seed_id), original_title=VALUES(original_title), year=VALUES(year), media_type=VALUES(media_type), " +
    "region=VALUES(region), languages=VALUES(languages), directors=VALUES(directors), writers=VALUES(writers), actors=VALUES(actors), genres=VALUES(genres), " +
    "rating=VALUES(rating), rating_count=VALUES(rating_count), release_date=VALUES(release_date), episodes=VALUES(episodes), duration=VALUES(duration), " +
    "summary=VALUES(summary), poster=VALUES(poster), douban_url=VALUES(douban_url), seed_url=VALUES(seed_url), source=VALUES(source)",
    [rec.douban_id || 0, rec.seed_id || 0, rec.title || "", rec.original_title || "", parseInt(rec.year, 10) || 0, rec.media_type || "", rec.region || "",
      rec.languages || "", rec.directors || "", rec.writers || "", rec.actors || "", rec.genres || "", rec.rating || 0, parseInt(rec.rating_count, 10) || 0,
      rec.release_date || "", parseInt(rec.episodes, 10) || 0, rec.duration || "", rec.summary || null, rec.poster || "",
      rec.douban_url || "", rec.seed_url || "", rec.source || "seeduck"]);
  return true;
}
async function doubanUpdate(id, fields) {
  if (!fields || !Object.keys(fields).length) return;
  await execute("UPDATE douban_subjects SET " + Object.keys(fields).map(function (k) { return k + "=?"; }).join(",") + " WHERE id=?",
    Object.keys(fields).map(function (k) { return fields[k]; }).concat([id]));
}
async function doubanDelete(id) { await execute("DELETE FROM douban_subjects WHERE id=?", [id]); }
async function doubanStats() {
  var total = await query("SELECT COUNT(*) c FROM douban_subjects");
  var byType = await query("SELECT media_type, COUNT(*) c FROM douban_subjects GROUP BY media_type");
  var linked = await query("SELECT COUNT(*) c FROM resources WHERE douban_id>0");
  return { total: total[0].c, byType: byType || [], linkedResources: linked[0].c };
}
async function doubanLinkResources(limit) {
  limit = parseInt(limit, 10) || 300;
  var res = await query("SELECT id, title FROM resources WHERE douban_id=0 AND status=1 AND title<>'' AND title IS NOT NULL ORDER BY id DESC LIMIT " + limit);
  var subjects = await query("SELECT douban_id, title FROM douban_subjects WHERE title<>'' AND title IS NOT NULL");
  var matched = 0;
  for (var i = 0; i < res.length; i++) {
    var t = String(res[i].title).trim();
    if (!t) continue;
    var hit = null;
    for (var j = 0; j < subjects.length; j++) {
      var st = String(subjects[j].title).trim();
      if (!st) continue;
      if (t === st || (st.length >= 4 && t.indexOf(st) >= 0)) { hit = subjects[j].douban_id; break; }
    }
    if (hit) {
      await execute("UPDATE resources SET douban_id=? WHERE id=?", [hit, res[i].id]);
      matched++;
    }
  }
  return { scanned: res.length, matched: matched };
}

module.exports = {
  loadConfig, ping, isReady, query, execute, reconnect, resourceExportAll,
  cfgGet, cfgGetAll, cfgSet, cfgSetAll,
  adminGet, adminVerify, adminSet, adminSetHash,
  cookieGet, cookieSet, cookieGetAll, cookieList, cookieAdd, cookieUpdate, cookieDelete,
  cacheGet, cacheSet, cacheStats, cacheClear,
  historyAdd, historyList, historyDelete, historyClear, historyDeleteBefore, cacheDeleteBefore,
  resourceAdd, resourceGet, resourceUpdate, resourceDelete, resourceDeleteBatch, resourceCount, resourceExists, resourceSearch,
  submitAdd, submitGet, submitList, submitReview,
  crawlerSourceList, crawlerSourceAdd, crawlerSourceUpdate, crawlerSourceDelete,
  crawlerRuleList, crawlerRuleAdd, crawlerRuleUpdate, crawlerRuleDelete,
  importLogAdd, importLogList, reportAdd, reportList,
  taskList, taskGetById, taskAdd, taskUpdate, taskDelete, taskLogList,
  scriptList, scriptGetByType, scriptSave, scriptDelete,
  keywordUpsert, keywordEnsure, keywordList, keywordUpdate, keywordDelete, keywordCollect,
  resourceHot, resourceStats, keywordCount, transferStats, resourceCountBySource, aiSummaryAdd, aiSummaryList, ensureTable,
  hotRankAdd, hotRankList, hotRankSaveSort, hotRankRemove, hotRankedIds,
  feedbackAdd, feedbackList, feedbackUpdate, feedbackDelete,
  categoryList, categoryAdd, categoryUpdate, categoryDelete, categoryRefCounts, categoryRenameRefs, categoryClearRefs,
  tableCount, ensureSeed, init, status, close,
  keywordCrawlerList, keywordCrawlerAdd, keywordCrawlerImport, keywordCrawlerUpdate, keywordCrawlerDelete, keywordCrawlerBatchSet, keywordCrawlerStats, keywordCrawlerTake, keywordCrawlerMarkCrawled,
  doubanList, doubanGet, doubanGetByDoubanId, doubanUpsert, doubanUpdate, doubanDelete, doubanStats, doubanLinkResources,
};
