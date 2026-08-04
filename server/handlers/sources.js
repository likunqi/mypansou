// server/handlers/sources.js — 后台搜索源管理：列出/启停多搜索源（写 site_config.multi_sources）
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");
const registry = require("../../lib/sources/registry");

// GET /api/admin/sources — 源列表（含启停状态）
async function list(req, res) {
  try {
    var cfg = await store.getConfig();
    var enabled = registry.getEnabledSet(cfg);
    var items = Object.keys(registry.REGISTRY).map(function (id) {
      var m = registry.REGISTRY[id];
      return { id: id, name: m.name, short: m.short, type: m.type, desc: m.desc, enabled: !!enabled[id] };
    });
    json(res, 200, { items: items, total: items.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/sources/update — {id, enabled} 写回 site_config.multi_sources
async function update(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var id = String(b.id || "").trim();
    if (!registry.REGISTRY[id]) { json(res, 400, { error: "unknown_source: " + id }); return; }
    var cfg = await store.getConfig();
    var ms = {};
    try { ms = cfg.multi_sources ? JSON.parse(cfg.multi_sources) : {}; } catch (e) { ms = {}; }
    ms[id] = !!b.enabled;
    await store.saveConfig({ multi_sources: JSON.stringify(ms) });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { list, update };
