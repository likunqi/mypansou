// server/handlers/sources.js — 后台搜索源管理：列表 / 启停 / 网盘限制（写 site_config.multi_sources）
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");
const registry = require("../../lib/sources/registry");

// GET /api/admin/sources — 源列表（含启停 + 网盘限制 disks）
async function list(req, res) {
  try {
    var cfg = await store.getConfig();
    var items = registry.getAllSources(cfg);
    json(res, 200, { items: items, total: items.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/sources/update — {id, enabled?, disks?} 写回 site_config.multi_sources
// disks 为空数组 = 不限制；仅更新传入字段
async function update(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var id = String(b.id || "").trim();
    if (!registry.REGISTRY[id]) { json(res, 400, { error: "unknown_source: " + id }); return; }
    var cfg = await store.getConfig();
    var ms = {};
    try { ms = cfg.multi_sources ? JSON.parse(cfg.multi_sources) : {}; } catch (e) { ms = {}; }
    var cur = registry.parseSourceCfg(ms[id], registry.REGISTRY[id].defaultEnabled !== false);
    if (b.enabled !== undefined) cur.enabled = !!b.enabled;
    if (Array.isArray(b.disks)) cur.disks = b.disks.filter(function (d) { return typeof d === "string" && d; });
    ms[id] = cur;
    await store.saveConfig({ multi_sources: JSON.stringify(ms) });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { list, update };
