// server/handlers/import.js — 资源入库三管道之二「批量导入」（CSV / JSON）
// POST /api/admin/import/upload  → 解析 + URL 去重 + 返回预览与统计（含 token）
// POST /api/admin/import/confirm → 按 token 批量写入 resources + 记 import_logs
// GET  /api/admin/import/logs    → 导入历史
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

// 预览暂存（内存，15 分钟过期；服务重启则需重新上传）
var pending = new Map(); // token -> {data, expireAt}

function token() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function normUrl(s) {
  s = String(s || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
function normRow(r) {
  return {
    title: String(r.title || r.name || "").trim().slice(0, 256),
    url: normUrl(r.url || r.link || r.share_url || "").slice(0, 512),
    password: String(r.password || r.pwd || r.code || "").trim().slice(0, 32),
    disk_type: String(r.disk_type || r.type || "quark").slice(0, 16),
    category: String(r.category || "").trim().slice(0, 64),
    tags: String(r.tags || "").trim().slice(0, 256),
    description: String(r.description || r.desc || "").trim(),
    file_name: String(r.file_name || "").trim().slice(0, 256),
    file_size: String(r.file_size || "").trim().slice(0, 32),
  };
}

// CSV → 行对象数组（简单解析：支持引号包裹的逗号）
function parseCsv(text) {
  var lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
  if (!lines.length) return [];
  function splitLine(l) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < l.length; i++) {
      var c = l[i];
      if (inQ) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
      else if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  var header = splitLine(lines[0]).map(function (h) { return h.trim(); });
  return lines.slice(1).map(function (l) {
    var cells = splitLine(l);
    var obj = {};
    for (var i = 0; i < header.length; i++) obj[header[i]] = (cells[i] || "").trim();
    return obj;
  });
}

async function upload(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var fileName = String(b.fileName || "").slice(0, 256);
    var content = String(b.content || "");
    var format = String(b.format || (fileName.toLowerCase().endsWith(".csv") ? "csv" : "json"));
    if (!content.trim()) return json(res, 400, { error: "empty_file", message: "文件内容为空" });

    var rawRows;
    if (format === "csv") rawRows = parseCsv(content);
    else { // json：数组 或 {rows:[...]} 或 {resources:[...]}
      var parsed = JSON.parse(content);
      rawRows = Array.isArray(parsed) ? parsed : (parsed.rows || parsed.resources || []);
    }
    if (!rawRows.length) return json(res, 400, { error: "no_rows", message: "未解析到任何行" });

    var rows = rawRows.map(normRow).filter(function (r) { return r.title && r.url; });
    var seen = new Set();
    var duplicates = 0, dupUrls = 0, invalid = rawRows.length - rows.length;
    var clean = [];
    for (var i = 0; i < rows.length; i++) {
      if (seen.has(rows[i].url)) { dupUrls++; continue; }
      seen.add(rows[i].url);
      clean.push(rows[i]);
    }
    duplicates = dupUrls;
    var tk = token();
    pending.set(tk, { data: clean, expireAt: Date.now() + 15 * 60 * 1000, meta: { fileName: fileName, format: format } });

    json(res, 200, {
      token: tk,
      stats: { total: rawRows.length, valid: clean.length, invalid: invalid, duplicate: duplicates },
      preview: clean.slice(0, 5),
    });
  } catch (e) { json(res, 500, { error: e.message, message: "解析失败，请检查文件格式" }); }
}

async function confirm(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var p = pending.get(b.token);
    if (!p || p.expireAt < Date.now()) {
      if (!p) return json(res, 400, { error: "token_expired", message: "预览已过期，请重新上传" });
    }
    pending.delete(b.token);
    var rows = p.data, imported = 0;
    for (var i = 0; i < rows.length; i++) {
      var rec = rows[i];
      rec.source = "imported";
      rec.status = 1;
      try { await store.resourceAdd(rec); imported++; } catch (e) {}
    }
    var log = {
      file_name: p.meta.fileName || "粘贴内容", file_format: p.meta.format,
      total_rows: rows.length, imported_rows: imported,
      skipped_rows: rows.length - imported, duplicate_urls: 0,
      category: b.category || "", disk_type: b.diskType || "", status: "completed",
    };
    await store.importLogAdd(log);
    json(res, 200, { ok: true, imported: imported, total: rows.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function logs(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var list = await store.importLogList(parseInt(u.searchParams.get("limit") || "50", 10));
  json(res, 200, { items: list });
}

module.exports = { upload, confirm, logs };
