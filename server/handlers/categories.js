// server/handlers/categories.js — 后台分类管理：CRUD / 排序 / 引用联动
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

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

module.exports = { list, add, update, del };
