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

// GET /api/admin/sources/:id/context — AI 生成规则前拉源上下文
// 返回：源详情 + 现有规则摘要 + 分类字典 + 字段/规则类型白名单（受控生成前端展示用）
async function context(req, res) {
  try {
    var parts = req.url.split("/");
    var id = parseInt(parts[parts.length - 2], 10); // /sources/:id/context → 倒数第二段是 id
    var list = await store.crawlerSourceList(false);
    var src = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) src = list[i];
    if (!src) return json(res, 404, { error: "source_not_found" });
    var rules = await store.crawlerRuleList(src.id);
    var cats = await store.categoryList();
    json(res, 200, {
      source: {
        id: src.id, name: src.name, source_type: src.source_type,
        url_template: src.url_template, category: src.category || "",
        disk_type: src.disk_type || "", status: src.status,
        last_crawled_at: src.last_crawled_at || "",
      },
      rules: (rules || []).map(function (r) {
        return { field_name: r.field_name, rule_type: r.rule_type, rule_value: r.rule_value, required: !!r.required };
      }),
      categories: (cats || []).map(function (c) { return c.name; }),
      field_whitelist: ["title", "url", "password", "desc", "category", "disk_type", "thumbnail", "extract_code"],
      rule_type_whitelist: ["regex", "jsonpath", "fixed", "concat"],
      pan_url_regex: "https://pan\\.(?:quark\\.cn|baidu\\.com)/s/[A-Za-z0-9_-]+",
    });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/sources/update — {id, enabled?, disks?, name?} 写回 site_config.multi_sources
// disks 为空数组 = 不限制；name 非空字符串才更新；仅更新传入字段
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
    if (typeof b.name === "string" && b.name.trim()) cur.name = b.name.trim();
    ms[id] = cur;
    await store.saveConfig({ multi_sources: JSON.stringify(ms) });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { list, update, context };
