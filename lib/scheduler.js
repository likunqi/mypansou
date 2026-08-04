// lib/scheduler.js — 服务内定时任务调度器
// 读取 scheduled_tasks 表（status=1），每 60s 检查一次到期任务，执行后写 task_logs。
// 设计要点：
//  - 首次启动只初始化 next_run_at（排期），不立即执行，避免一启动就删数据；
//  - next_run_at 为空时按 task_config.time（HH:MM）排到下次该时刻，否则 now + interval；
//  - MySQL 不可用时静默跳过，不影响服务主流程。
const mysql = require("./mysql");

const TASK_HANDLERS = {
  cleanup: require("../server/tasks/cleanup"),
  douban_hotwords: require("../server/tasks/douban_hotwords"),
};

let timer = null;
let started = false;

function pad(n) { return (n < 10 ? "0" : "") + n; }
function toSql(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function parseConfig(t) {
  var c = t.task_config;
  if (typeof c === "string") { try { return JSON.parse(c) || {}; } catch (e) { return {}; } }
  if (c && typeof c === "object") return c; // mysql2 已把 JSON 列解析成对象
  return {};
}

function nextRunAt(t, config) {
  var now = new Date();
  if (config && config.time) {
    var m = String(config.time).match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      var d = new Date(now);
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1); // 今天已过则明天
      return d;
    }
  }
  return new Date(now.getTime() + (t.interval_sec || 3600) * 1000);
}

async function logTask(t, r) {
  try {
    await mysql.execute(
      "INSERT INTO task_logs (task_id, task_type, status, started_at, finished_at, duration_ms, result_msg, error_msg) VALUES (?,?,?,?,?,?,?,?)",
      [t.id, t.task_type, r.status || "ok",
        r.startedAt ? toSql(new Date(r.startedAt)) : toSql(new Date()),
        toSql(new Date()), r.durationMs || 0,
        r.resultMsg || null, r.error || null]);
  } catch (e) { console.error("[scheduler] logTask:", e.message); }
}

async function tick() {
  var rows;
  try {
    rows = await mysql.query("SELECT * FROM scheduled_tasks WHERE status=1 AND next_run_at IS NOT NULL AND next_run_at <= NOW()");
  } catch (e) { return; }
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i];
    var config = parseConfig(t);
    var next = toSql(nextRunAt(t, config));
    var handler = TASK_HANDLERS[t.task_type];
    var startedAt = Date.now();

    if (!handler) {
      // 未实现的任务类型：仅顺延下次执行
      await mysql.execute("UPDATE scheduled_tasks SET next_run_at=? WHERE id=?", [next, t.id]);
      continue;
    }

    var r = { status: "failed", error: "unknown" };
    try {
      r = (await handler.run(config, t)) || {};
    } catch (e) { r.status = "failed"; r.error = e.message; }
    r.startedAt = startedAt;
    r.durationMs = Date.now() - startedAt;
    await logTask(t, r);
    await mysql.execute("UPDATE scheduled_tasks SET last_run_at=NOW(), next_run_at=? WHERE id=?", [next, t.id]);
    console.log("[scheduler] 任务执行:", t.task_type, "->", r.status, r.resultMsg || r.error || "");
  }
}

async function start() {
  if (started) return;
  started = true;
  // 初始化：为 next_run_at 为空的活跃任务排期（不执行）
  try {
    var rows = await mysql.query("SELECT * FROM scheduled_tasks WHERE status=1 AND next_run_at IS NULL");
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i], config = parseConfig(t);
      await mysql.execute("UPDATE scheduled_tasks SET next_run_at=? WHERE id=?", [toSql(nextRunAt(t, config)), t.id]);
      console.log("[scheduler] 任务排期:", t.task_type, "->", nextRunAt(t, config).toLocaleString("zh-CN", { hour12: false }));
    }
  } catch (e) {
    // MySQL 未连：5 分钟后再试（服务恢复后自动接管）
    started = false;
    console.log("[scheduler] MySQL 不可达，5 分钟后重试");
    setTimeout(start, 5 * 60 * 1000);
    return;
  }
  timer = setInterval(tick, 60 * 1000);
  console.log("[scheduler] 定时任务已启动（每 60s 检查一次）");
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick, nextRunAt };
