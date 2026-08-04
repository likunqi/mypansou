// server/handlers/tasks.js — 任务中心 API
// 后台「任务中心」页：任务 CRUD + 启停 + 立即执行 + 执行日志 + 自定义脚本任务
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const scheduler = require("../../lib/scheduler");

// 任务列表（含类型元数据）
async function list(req, res) {
  try {
    var rows = await mysql.taskList();
    var types = scheduler.TASK_TYPES || {};
    var items = (rows || []).map(function (t) {
      return {
        id: t.id, task_name: t.task_name, task_type: t.task_type,
        type_label: (types[t.task_type] && types[t.task_type].label) || t.task_type,
        type_desc: (types[t.task_type] && types[t.task_type].desc) || "",
        interval_sec: t.interval_sec, task_config: t.task_config,
        status: t.status, last_run_at: t.last_run_at, next_run_at: t.next_run_at,
        created_at: t.created_at,
      };
    });
    json(res, 200, { items: items, total: items.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 可用任务类型 + 自定义脚本列表（新建任务表单用）
async function types(req, res) {
  try {
    var types = scheduler.TASK_TYPES || {};
    var typeList = Object.keys(types).map(function (k) {
      return { type: k, label: types[k].label, desc: types[k].desc };
    });
    var scripts = await mysql.scriptList("task");
    json(res, 200, { types: typeList, scripts: scripts || [] });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 新建任务：type=script 时同步写 custom_scripts 脚本，再建 scheduled_tasks
async function add(req, res) {
  try {
    var body = JSON.parse(await readBody(req) || "{}");
    var taskType = body.task_type;
    if (!taskType) return json(res, 400, { error: "task_type 必填" });
    var intervalSec = parseInt(body.interval_sec, 10) || 3600;

    if (taskType === "script") {
      if (!body.script_code) return json(res, 400, { error: "script_code 必填" });
      var scriptId = await mysql.scriptSave({
        script_name: body.task_name || "自定义任务", script_type: "task",
        script_code: body.script_code, enabled: 1,
      });
      var taskId = await mysql.taskAdd({
        task_name: body.task_name || "自定义任务", task_type: "script",
        interval_sec: intervalSec, task_config: { script_id: scriptId }, status: 1,
      });
      return json(res, 200, { ok: true, id: taskId, script_id: scriptId });
    }

    var id = await mysql.taskAdd({
      task_name: body.task_name, task_type: taskType,
      interval_sec: intervalSec, task_config: body.task_config || {}, status: 1,
    });
    json(res, 200, { ok: true, id: id });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 更新：启停/改间隔/改配置；script 类型可同步改脚本代码
async function update(req, res) {
  try {
    var id = parseInt(req.url.split("/").pop(), 10);
    var body = JSON.parse(await readBody(req) || "{}");
    var t = await mysql.taskGetById(id);
    if (!t) return json(res, 404, { error: "任务不存在" });

    var fields = {};
    if (body.task_name !== undefined) fields.task_name = body.task_name;
    if (body.interval_sec !== undefined) fields.interval_sec = parseInt(body.interval_sec, 10) || t.interval_sec;
    if (body.task_config !== undefined) fields.task_config = body.task_config;
    if (body.status !== undefined) {
      fields.status = body.status ? 1 : 0;
      // 启停时重新排期：启用立即排期，停用清空下次运行
      fields.next_run_at = body.status ? null : null;
    }
    if (Object.keys(fields).length) await mysql.taskUpdate(id, fields);

    // script 类型：同步更新脚本代码
    if (t.task_type === "script" && body.script_code !== undefined) {
      var scriptId = t.task_config && t.task_config.script_id;
      if (scriptId) {
        await mysql.scriptSave({ id: scriptId, script_name: body.task_name || t.task_name, script_type: "task", script_code: body.script_code, enabled: 1 });
      }
    }
    // 启用后立即排期（next_run_at 为空时 scheduler.start 不会管已存在的任务，这里主动补）
    if (body.status === true || body.status === 1) {
      var next = scheduler.nextRunAt(t, body.task_config || (t.task_config ? t.task_config : {}));
      var d = next instanceof Date ? next : new Date(Date.now() + (t.interval_sec || 3600) * 1000);
      await mysql.taskUpdate(id, { next_run_at: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":00" });
    }
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 删除：同步清理关联脚本
async function del(req, res) {
  try {
    var id = parseInt(req.url.split("/").pop(), 10);
    var t = await mysql.taskGetById(id);
    if (!t) return json(res, 404, { error: "任务不存在" });
    if (t.task_type === "script" && t.task_config && t.task_config.script_id) {
      try { await mysql.scriptDelete(t.task_config.script_id); } catch (e) {}
    }
    await mysql.taskDelete(id);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 立即执行一次（不更新排期）
async function runNow(req, res) {
  try {
    var id = parseInt(req.url.split("/")[req.url.split("/").length - 2], 10);
    var t = await mysql.taskGetById(id);
    if (!t) return json(res, 404, { error: "任务不存在" });
    var r = await scheduler.runTaskNow(id);
    json(res, 200, { ok: r.status === "ok", status: r.status, result: r.resultMsg || null, error: r.error || null, duration_ms: r.durationMs || 0 });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 执行日志
async function logs(req, res) {
  try {
    var u = new URL(req.url, "http://x");
    var taskId = u.searchParams.get("task_id");
    var limit = parseInt(u.searchParams.get("limit"), 10) || 50;
    var rows = await mysql.taskLogList(taskId || null, limit);
    json(res, 200, { items: rows || [] });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { list, types, add, update, del, runNow, logs };
