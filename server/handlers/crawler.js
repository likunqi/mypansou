// server/handlers/crawler.js — 资源入库三管道之三「自动采集」管理
// 采集源 CRUD + 解析规则 CRUD + 手动触发（test/run）
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");
const engine = require("../../lib/crawler-engine");

// ---------- 采集源 ----------
async function sourceList(req, res) {
  var rows = await store.crawlerSourceList(false);
  json(res, 200, { items: rows });
}
async function sourceAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    if (!b.name || !b.source_type || !b.url_template) return json(res, 400, { error: "fields_required", message: "名称/类型/URL模板 必填" });
    if (["rss", "page", "api"].indexOf(b.source_type) === -1) return json(res, 400, { error: "bad_source_type" });
    var id = await store.crawlerSourceAdd(b);
    json(res, 200, { ok: true, id: id });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function sourceUpdate(req, res) {
  try {
    var id = req.url.split("/")[5];
    var b = JSON.parse(await readBody(req));
    await store.crawlerSourceUpdate(id, b);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function sourceDelete(req, res) {
  try {
    var id = req.url.split("/")[5];
    await store.crawlerSourceDelete(id);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 手动触发采集（test: 只解析不写入；run: 写入 resources）
async function sourceRun(req, res) {
  try {
    var id = req.url.split("/")[5];
    var u = new URL(req.url, "http://" + req.headers.host);
    var dryRun = u.searchParams.get("dry") === "1";
    var list = await store.crawlerSourceList(false);
    var source = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) source = list[i];
    if (!source) return json(res, 404, { error: "source_not_found" });
    var rules = await store.crawlerRuleList(id);
    var r = await engine.crawlSource(source, rules, { dryRun: dryRun });
    if (!dryRun && r.status === "ok") {
      await store.crawlerSourceUpdate(id, { last_crawled_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    }
    json(res, 200, r);
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 解析规则 ----------
async function ruleList(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var rows = await store.crawlerRuleList(u.searchParams.get("source_id") || "");
  json(res, 200, { items: rows });
}
async function ruleAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    if (!b.source_id || !b.field_name || !b.rule_value) return json(res, 400, { error: "fields_required", message: "source_id/字段/规则值 必填" });
    var id = await store.crawlerRuleAdd(b);
    json(res, 200, { ok: true, id: id });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function ruleUpdate(req, res) {
  try {
    var id = req.url.split("/")[5];
    var b = JSON.parse(await readBody(req));
    await store.crawlerRuleUpdate(id, b);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function ruleDelete(req, res) {
  try {
    var id = req.url.split("/")[5];
    await store.crawlerRuleDelete(id);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { sourceList, sourceAdd, sourceUpdate, sourceDelete, sourceRun, ruleList, ruleAdd, ruleUpdate, ruleDelete };
