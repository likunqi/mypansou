// server/handlers/feedback.js — 失效反馈：用户提交（公开）+ 后台审核处理
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

// 用户提交失效反馈（公开，无需登录）：{resource_id, title, url, disk_type}
async function submit(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    var rid = parseInt(b.resource_id, 10);
    if (!rid || !b.url) { json(res, 400, { error: "resource_id/url 必填" }); return; }
    var id = await store.feedbackAdd({ resource_id: rid, title: String(b.title || "").slice(0, 500), url: String(b.url || "").slice(0, 1000), disk_type: String(b.disk_type || "") });
    json(res, 200, { ok: true, id: id });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 后台反馈列表：?status=0/1/2
async function adminList(req, res) {
  try {
    var u = new URL(req.url, "http://" + req.headers.host);
    var st = u.searchParams.get("status") || "";
    var rows = await store.feedbackList(st);
    json(res, 200, { items: rows || [], total: (rows || []).length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 后台处理：POST /api/admin/feedback/:id  {action:"invalid"|"remove"|"dismiss", remark}
//  invalid → 标记资源链接失效（link_valid=0）；remove → 删除资源；dismiss → 驳回（反馈保留）
async function adminHandle(req, res) {
  try {
    var m = req.url.match(/\/api\/admin\/feedback\/(\d+)/);
    if (!m) { json(res, 400, { error: "bad_id" }); return; }
    var b = JSON.parse(await readBody(req) || "{}");
    var action = b.action || "dismiss";
    var remark = String(b.remark || "").slice(0, 500);
    var fbs = await store.feedbackList("");
    var fb = (fbs || []).find(function (x) { return String(x.id) === String(m[1]); });
    if (!fb) { json(res, 404, { error: "反馈不存在" }); return; }
    if (action === "invalid") {
      if (fb.resource_id) await store.resourceUpdate(fb.resource_id, { link_valid: 0, check_message: "用户反馈失效" });
      await store.feedbackUpdate(m[1], { status: 1, admin_remark: remark || "已确认失效" });
    } else if (action === "remove") {
      if (fb.resource_id) await store.resourceDelete(fb.resource_id);
      await store.feedbackUpdate(m[1], { status: 1, admin_remark: remark || "已删除资源" });
    } else {
      await store.feedbackUpdate(m[1], { status: 2, admin_remark: remark || "已驳回" });
    }
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { submit, adminList, adminHandle };
