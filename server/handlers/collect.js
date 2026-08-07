// server/handlers/collect.js — 采集词库 + 豆瓣资料 后台 API（8-07 新增）
const { json, readBody } = require("../middleware");
const mysql = require("../../lib/mysql");
const seedhub = require("../../lib/seedhub");
const taskCollect = require("../tasks/resource_collect");

function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

// ============ 采集词库 ============
async function kwList(req, res) {
  try {
    var u = new URL(req.url, "http://x");
    var opt = {
      kw: u.searchParams.get("kw") || "",
      category: u.searchParams.get("category") || "",
      source: u.searchParams.get("source") || "",
      status: u.searchParams.get("status") || "",
      page: num(u.searchParams.get("page") || 1),
      size: num(u.searchParams.get("size") || 20),
    };
    var r = await mysql.keywordCrawlerList(opt);
    json(res, 200, r);
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwStats(req, res) {
  try {
    var r = await mysql.keywordCrawlerStats();
    json(res, 200, r);
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    if (!b.keyword) return json(res, 400, { error: "keyword 必填" });
    var r = await mysql.keywordCrawlerAdd({ keyword: b.keyword, category: b.category || "", source: b.source || "manual", weight: b.weight, status: b.status });
    json(res, 200, { ok: true, inserted: r.inserted, message: r.inserted ? "已添加" : "词已存在（跳过）" });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwImportPreset(req, res) {
  try {
    var r = await mysql.keywordCrawlerImport(
      taskCollect.PRESET_KEYWORDS ? taskCollect.PRESET_KEYWORDS.map(function (p) { return { keyword: p[0], category: p[1], source: "preset", weight: 15 }; }) : []);
    json(res, 200, { ok: true, inserted: r.inserted, skipped: r.skipped });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwImportHot(req, res) {
  try {
    var hots = await mysql.query("SELECT keyword, search_count FROM search_keywords WHERE status=1 AND search_count>=1 LIMIT 500");
    var clean = [];
    (hots || []).forEach(function (h) {
      var k = taskCollect.cleanHotword(h.keyword);
      if (k) clean.push({ keyword: k, category: "综合", source: "hotword", weight: 12 });
    });
    var r = await mysql.keywordCrawlerImport(clean);
    json(res, 200, { ok: true, scanned: (hots || []).length, inserted: r.inserted, skipped: r.skipped });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwBatchStatus(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    if (!b.ids || !b.ids.length) return json(res, 400, { error: "ids 必填" });
    var n = await mysql.keywordCrawlerBatchSet(b.ids.map(num), b.status ? 1 : 0);
    json(res, 200, { ok: true, updated: n });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwUpdate(req, res) {
  try {
    var id = num(req.url.split("/").pop());
    var b = JSON.parse(await readBody(req) || "{}");
    var fields = {};
    if (b.keyword !== undefined) fields.keyword = b.keyword;
    if (b.category !== undefined) fields.category = b.category;
    if (b.source !== undefined) fields.source = b.source;
    if (b.weight !== undefined) fields.weight = num(b.weight);
    if (b.status !== undefined) fields.status = b.status ? 1 : 0;
    await mysql.keywordCrawlerUpdate(id, fields);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function kwDelete(req, res) {
  try {
    var id = num(req.url.split("/")[req.url.split("/").length - 2]);
    await mysql.keywordCrawlerDelete(id);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ============ 豆瓣资料 ============
async function dbList(req, res) {
  try {
    var u = new URL(req.url, "http://x");
    var opt = {
      kw: u.searchParams.get("kw") || "",
      media_type: u.searchParams.get("media_type") || "",
      rating_min: u.searchParams.get("rating_min") || "",
      page: num(u.searchParams.get("page") || 1),
      size: num(u.searchParams.get("size") || 20),
    };
    var r = await mysql.doubanList(opt);
    json(res, 200, r);
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function dbStats(req, res) {
  try {
    var r = await mysql.doubanStats();
    json(res, 200, r);
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function dbSync(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    var limit = num(b.limit || 30);
    var pages = num(b.pages || 2);
    var r = await seedhub.crawlNew(limit, pages);
    json(res, 200, { ok: true, inserted: r.inserted, updated: r.updated, skipped: r.skipped, errors: r.errors, matched: r.matched });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function dbMatch(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    var r = await mysql.doubanLinkResources(num(b.limit || 300));
    json(res, 200, { ok: true, scanned: r.scanned, matched: r.matched });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function dbDelete(req, res) {
  try {
    var id = num(req.url.split("/")[req.url.split("/").length - 2]);
    await mysql.doubanDelete(id);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function dbUpdate(req, res) {
  try {
    var id = num(req.url.split("/")[req.url.split("/").length - 2]);
    var b = JSON.parse(await readBody(req) || "{}");
    var fields = {};
    if (b.status !== undefined) fields.status = b.status ? 1 : 0;
    if (b.rating !== undefined) fields.rating = parseFloat(b.rating) || 0;
    if (b.title !== undefined) fields.title = b.title;
    if (b.media_type !== undefined) fields.media_type = b.media_type;
    if (b.category_note !== undefined) fields.category_note = b.category_note;
    if (Object.keys(fields).length) await mysql.doubanUpdate(id, fields);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { kwList, kwStats, kwAdd, kwImportPreset, kwImportHot, kwBatchStatus, kwUpdate, kwDelete, dbList, dbStats, dbSync, dbMatch, dbDelete, dbUpdate };
