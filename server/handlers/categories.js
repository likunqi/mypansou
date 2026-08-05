// server/handlers/categories.js — 后台分类管理：CRUD / 排序 / 引用联动 / TG 频道分类映射
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

// TG 频道已知列表（分类映射配置用；与 tg.js CH_NAME 保持一致，此处只用于展示已知频道）
const KNOWN_CHANNELS = [
  "okpojie", "softwareGods", "happyflims", "allgamegod", "freekecheng", "ShortDramaGod",
  "allgirlhunter", "Aliyun_4K_Movies", "netdisk_movies",
  "bdyunpan", "BaiduCloudDisk", "yunpan139", "yunpan189", "yp123pan", "yunpanuc", "yunpanxunlei", "yunpans",
];

// site_config.tg_channel_cats = JSON 字符串 {频道名: 分类名}
function readTgCatMap(cfg) {
  var raw = cfg && cfg.tg_channel_cats;
  if (typeof raw === "string") { try { return JSON.parse(raw) || {}; } catch (e) { return {}; } }
  return raw && typeof raw === "object" ? raw : {};
}

// GET /api/admin/categories — 分类列表（含资源/源引用计数）
async function list(req, res) {
  try {
    var items = await store.categoryList();
    var refs = await store.categoryRefCounts();
    var out = items.map(function (c) {
      var r = refs[c.name] || { res: 0, src: 0 };
      return {
        id: c.id, name: c.name, sort_order: c.sort_order || 0, status: c.status,
        res_count: r.res || 0, src_count: r.src || 0,
      };
    });
    json(res, 200, { items: out, total: out.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/categories — 新增 {name, sort_order?, status?}
async function add(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var name = String(b.name || "").trim();
    if (!name) return json(res, 400, { error: "分类名称必填" });
    if (name.length > 64) return json(res, 400, { error: "分类名称过长（≤64）" });
    var items = await store.categoryList();
    var dup = items.find(function (c) { return c.name === name; });
    if (dup) return json(res, 400, { error: "分类已存在" });
    var id = await store.categoryAdd({
      name: name,
      sort_order: parseInt(b.sort_order, 10) || 0,
      status: b.status === undefined ? 1 : (b.status ? 1 : 0),
    });
    json(res, 200, { ok: true, id: id });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/categories/:id — 更新 {name?, sort_order?, status?}；改名联动 resources/crawler_sources
async function update(req, res) {
  try {
    var id = parseInt((req.url.match(/\/categories\/(\d+)/) || [])[1], 10);
    if (!id) return json(res, 400, { error: "bad_id" });
    var b = JSON.parse(await readBody(req));
    var cur = (await store.categoryList()).find(function (c) { return String(c.id) === String(id); });
    if (!cur) return json(res, 404, { error: "分类不存在" });
    var fields = {};
    if (b.name !== undefined) {
      var name = String(b.name).trim();
      if (!name) return json(res, 400, { error: "分类名称必填" });
      if (name.length > 64) return json(res, 400, { error: "分类名称过长（≤64）" });
      if (name !== cur.name) {
        var dup = (await store.categoryList()).find(function (c) { return c.name === name; });
        if (dup) return json(res, 400, { error: "分类已存在" });
        fields.name = name;
      }
    }
    if (b.sort_order !== undefined) fields.sort_order = parseInt(b.sort_order, 10) || 0;
    if (b.status !== undefined) fields.status = b.status ? 1 : 0;
    if (Object.keys(fields).length) {
      await store.categoryUpdate(id, fields);
      if (fields.name && fields.name !== cur.name) await store.categoryRenameRefs(cur.name, fields.name);
    }
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// DELETE /api/admin/categories/:id — 删除（引用分类的资源/源置空，不删数据）
async function del(req, res) {
  try {
    var id = parseInt((req.url.match(/\/categories\/(\d+)/) || [])[1], 10);
    if (!id) return json(res, 400, { error: "bad_id" });
    var cur = (await store.categoryList()).find(function (c) { return String(c.id) === String(id); });
    if (!cur) return json(res, 404, { error: "分类不存在" });
    var refs = await store.categoryRefCounts();
    var r = refs[cur.name] || { res: 0, src: 0 };
    await store.categoryDelete(id);
    await store.categoryClearRefs(cur.name);
    json(res, 200, { ok: true, cleared: { res: r.res || 0, src: r.src || 0 } });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// GET /api/admin/categories/tgmap — TG 频道 → 分类映射（含全部已知频道 + 当前配置 + 候选分类）
async function tgMap(req, res) {
  try {
    var cfg = await store.getConfig();
    var map = readTgCatMap(cfg);
    var cats = await store.categoryList();
    json(res, 200, {
      channels: KNOWN_CHANNELS,
      map: map,
      categories: cats.map(function (c) { return c.name; }),
    });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/categories/tgmap — 保存映射 {map: {频道: 分类名}}（分类名空=清除该频道映射）
async function saveTgMap(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    if (!b.map || typeof b.map !== "object") return json(res, 400, { error: "map 必填" });
    var clean = {};
    for (var ch in b.map) {
      var v = String(b.map[ch] || "").trim();
      if (v) clean[ch] = v;
    }
    await store.saveConfig({ tg_channel_cats: JSON.stringify(clean) });
    json(res, 200, { ok: true, map: clean });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { list, add, update, del, tgMap, saveTgMap };
