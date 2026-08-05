// server/handlers/resource.js — 资源入库三管道之一「人工提交」+ 本地搜索 + 失效反馈
// 公开：POST /api/submit/resource、GET /api/search/local、POST /api/resources/:id/report
// 管理：资源列表/新增/编辑/删除、提交审核（通过转 resources / 驳回）
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

function clean(b) {
  b = b || {};
  return {
    title: String(b.title || "").trim().slice(0, 256),
    url: String(b.url || "").trim().slice(0, 512),
    password: String(b.password || "").trim().slice(0, 32),
    disk_type: String(b.disk_type || "quark").slice(0, 16),
    category: String(b.category || "").trim().slice(0, 64),
    tags: String(b.tags || "").trim().slice(0, 256),
    description: String(b.description || "").trim(),
    thumbnail: String(b.thumbnail || "").trim().slice(0, 512),
    file_name: String(b.file_name || "").trim().slice(0, 256),
    file_size: String(b.file_size || "").trim().slice(0, 32),
    source: String(b.source || "manual").slice(0, 16),
  };
}
function isUrl(s) { return /^https?:\/\//i.test(s); }

// ---------- 公开：用户提交资源 ----------
async function submitResource(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var rec = {
      title: String(b.title || "").trim(),
      url: String(b.url || "").trim(),
      password: String(b.password || "").trim(),
      disk_type: String(b.disk_type || "quark"),
      description: String(b.description || "").trim(),
      category: String(b.category || "").trim(),
      submitter_name: String(b.submitter_name || "").trim(),
      submitter_contact: String(b.submitter_contact || "").trim(),
    };
    if (!rec.title) return json(res, 400, { error: "title_required", message: "标题不能为空" });
    if (!rec.url || !isUrl(rec.url)) return json(res, 400, { error: "url_invalid", message: "请填写有效的 http(s) 链接" });
    var id = await store.submitAdd(rec);
    json(res, 200, { ok: true, id: id, status: 0 });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 公开：本地资源搜索（resources 表） ----------
async function localSearch(req, res) {
  try {
    var u = new URL(req.url, "http://" + req.headers.host);
    var opt = {
      kw: u.searchParams.get("kw") || "",
      category: u.searchParams.get("category") || "",
      diskType: u.searchParams.get("disk_type") || "",
      page: u.searchParams.get("page") || "1",
      size: u.searchParams.get("size") || "20",
      status: 1, // 本地搜索只展示启用资源
    };
    var r = await store.resourceSearch(opt);
    json(res, 200, r);
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 公开：用户反馈链接失效 ----------
async function reportBroken(req, res) {
  try {
    var id = req.url.split("/")[3];
    var b = JSON.parse(await readBody(req) || "{}");
    var r = await store.resourceGet(id);
    if (!r) return json(res, 404, { error: "resource_not_found" });
    await store.reportAdd({ resource_id: id, url: r.url, reason: String(b.reason || "").slice(0, 256), reporter_ip: req.socket.remoteAddress || "" });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 管理：资源列表（后台） ----------
async function adminList(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var opt = {
    kw: u.searchParams.get("kw") || "",
    category: u.searchParams.get("category") || "",
    diskType: u.searchParams.get("disk_type") || "",
    source: u.searchParams.get("source") || "",
    status: u.searchParams.get("status") || "",
    page: u.searchParams.get("page") || "1",
    size: u.searchParams.get("size") || "20",
  };
  var r = await store.resourceSearch(opt);
  json(res, 200, r);
}

// ---------- 管理：手动新增资源（source=manual） ----------
async function adminAdd(req, res) {
  try {
    var rec = clean(JSON.parse(await readBody(req)));
    if (!rec.title) return json(res, 400, { error: "title_required" });
    if (!isUrl(rec.url)) return json(res, 400, { error: "url_invalid" });
    rec.source = "manual";
    var id = await store.resourceAdd(rec);
    json(res, 200, { ok: true, id: id });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 管理：编辑资源 ----------
async function adminUpdate(req, res) {
  try {
    var id = req.url.split("/")[4];
    var raw = JSON.parse(await readBody(req));           // 原始 body：判断哪些字段被提交
    var rec = clean(raw);                                // 规范化后的值
    var cur = await store.resourceGet(id);
    if (!cur) return json(res, 404, { error: "resource_not_found" });
    var fields = {};
    ["title","url","password","disk_type","category","tags","description","thumbnail","file_name","file_size","status"].forEach(function (k) {
      // 只更新 body 里实际出现的字段，避免单字段提交清空其他字段
      if (raw[k] !== undefined && String(rec[k] || "") !== String(cur[k] || "")) fields[k] = rec[k];
    });
    await store.resourceUpdate(id, fields);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 管理：删除资源 ----------
async function adminDelete(req, res) {
  try {
    var id = req.url.split("/")[4];
    await store.resourceDelete(id);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 管理：批量删除资源（多选） ----------
async function adminDeleteBatch(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(function (n) { return n > 0; }) : [];
    if (!ids.length) return json(res, 400, { error: "ids_required" });
    var deleted = await store.resourceDeleteBatch(ids);
    json(res, 200, { ok: true, deleted: deleted });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 管理：提交审核列表 ----------
async function adminSubmissions(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var r = await store.submitList(
    u.searchParams.get("status") || "",
    u.searchParams.get("page") || "1",
    u.searchParams.get("size") || "20");
  json(res, 200, r);
}

// ---------- 管理：审核通过（status=1 → 写入 resources + 回写 resource_id） ----------
async function adminApprove(req, res) {
  try {
    var id = req.url.split("/")[4];
    var s = await getSubmission(id);
    if (!s) return json(res, 404, { error: "submission_not_found" });
    if (s.status !== 0) return json(res, 400, { error: "already_reviewed", message: "该提交已审核" });
    var rec = {
      title: s.title, url: s.url, password: s.password || "", disk_type: s.disk_type || "quark",
      category: s.category || "", description: s.description || null,
      source: "submitted", source_id: String(s.id), status: 1,
    };
    var rid = await store.resourceAdd(rec);
    await store.submitReview(id, 1, "", rid);
    json(res, 200, { ok: true, resource_id: rid });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 管理：驳回（status=2 + admin_remark） ----------
async function adminReject(req, res) {
  try {
    var id = req.url.split("/")[4];
    var b = JSON.parse(await readBody(req));
    var s = await getSubmission(id);
    if (!s) return json(res, 404, { error: "submission_not_found" });
    if (s.status !== 0) return json(res, 400, { error: "already_reviewed" });
    await store.submitReview(id, 2, String(b.remark || "").slice(0, 256), null);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 辅助：读单条提交（store 未暴露 submitGet，直接走 mysql / 或从列表取）
async function getSubmission(id) {
  var mysql = require("../../lib/mysql");
  try {
    var r = await mysql.submitGet(id);
    if (r) return r;
  } catch (e) {}
  var list = await store.submitList("", 1, 200);
  for (var i = 0; i < list.items.length; i++) {
    if (String(list.items[i].id) === String(id)) return list.items[i];
  }
  return null;
}

module.exports = {
  submitResource, localSearch, reportBroken,
  adminList, adminAdd, adminUpdate, adminDelete, adminDeleteBatch,
  adminSubmissions, adminApprove, adminReject,
};
