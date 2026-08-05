// lib/scheduler.js — 服务内定时任务调度器
// 读取 scheduled_tasks 表（status=1），每 60s 检查一次到期任务，执行后写 task_logs。
// 设计要点：
//  - 首次启动只初始化 next_run_at（排期），不立即执行，避免一启动就删数据；
//  - next_run_at 为空时按 task_config.time（HH:MM）排到下次该时刻，否则 now + interval；
//  - MySQL 不可用时静默跳过，不影响服务主流程。
//  - 任务类型双轨：内置任务（server/tasks/*.js 文件注册）+ 自定义脚本任务（custom_scripts script_type='task'）
const mysql = require("./mysql");

const TASK_HANDLERS = {
  cleanup: require("../server/tasks/cleanup"),
  douban_hotwords: require("../server/tasks/douban_hotwords"),
  trending_prewarm: require("../server/tasks/trending_prewarm"),
  crawl_source: require("../server/tasks/crawl_source"),
};

// 内置任务元数据（任务中心类型列表用）：label=显示名，desc=说明
const TASK_TYPES = {
  cleanup: { label: "夸克目录清理", desc: "每日清理 pansou 目录当天之前的转存文件" },
  douban_hotwords: { label: "豆瓣热词采集", desc: "每日 08:00 把豆瓣热榜 Top10 采集为热搜词" },
  trending_prewarm: { label: "热门推荐预热", desc: "每 30 分钟刷新首页热门推荐缓存" },
  crawl_source: { label: "采集源任务", desc: "按采集源 ID 定时跑其全部解析规则入库（与规则关联）" },
  script: { label: "自定义脚本", desc: "后台写 JS 代码定时执行（存 custom_scripts）" },
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

// 自定义脚本任务执行器：从 custom_scripts 取 script_type='task' 的脚本，按 script_id 执行
async function runScriptTask(config) {
  var scriptId = config && config.script_id;
  if (!scriptId) return { status: "failed", error: "未配置 script_id" };
  var scripts = await mysql.scriptList("task");
  var script = (scripts || []).find(function (s) { return s.id === Number(scriptId); });
  if (!script) return { status: "failed", error: "脚本不存在或已删除" };
  if (!script.enabled) return { status: "failed", error: "脚本已停用" };
  // 脚本约定：async function run(ctx) {...}; module.exports={run} 或直接 async 函数体
  var fn;
  try {
    // ctx.crawlSource：脚本可触发指定采集源规则采集（与采集解析规则关联）
    function crawlSource(sourceId) {
      var task = require("./tasks/crawl_source");
      return task.run({ source_id: sourceId });
    }
    var wrapped = "module.exports = { run: " + script.script_code + " }";
    fn = require("vm").runInNewContext(wrapped, { module: { exports: {} }, console: console, require: require, store: require("./store"), mysql: require("./mysql"), fetch: global.fetch, Date: Date, JSON: JSON, Promise: Promise, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout, crawlSource: crawlSource }, { timeout: 60000 });
    if (typeof fn.run !== "function") return { status: "failed", error: "脚本未导出 run 函数" };
    var r = await fn.run(config, {});
    return r && typeof r === "object" ? r : { status: "ok", resultMsg: String(r === undefined ? "完成" : r) };
  } catch (e) {
    return { status: "failed", error: e.message };
  }
}

// 按 task_type 解析 handler：内置注册表优先，script 类型走脚本执行器
async function resolveHandler(t) {
  var builtin = TASK_HANDLERS[t.task_type];
  if (builtin) return builtin;
  if (t.task_type === "script") return { run: function (config) { return runScriptTask(config); } };
  return null;
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

async function executeTask(t, manual) {
  var config = parseConfig(t);
  var next = toSql(nextRunAt(t, config));
  var handler = await resolveHandler(t);
  var startedAt = Date.now();

  if (!handler) {
    // 未实现的任务类型：仅顺延下次执行
    await mysql.execute("UPDATE scheduled_tasks SET next_run_at=? WHERE id=?", [next, t.id]);
    return { status: "skipped", error: "未知任务类型: " + t.task_type };
  }

  var r = { status: "failed", error: "unknown" };
  try {
    r = (await handler.run(config, t)) || {};
  } catch (e) { r.status = "failed"; r.error = e.message; }
  r.startedAt = startedAt;
  r.durationMs = Date.now() - startedAt;
  await logTask(t, r);
  if (!manual) {
    await mysql.execute("UPDATE scheduled_tasks SET last_run_at=NOW(), next_run_at=? WHERE id=?", [next, t.id]);
  }
  console.log("[scheduler] 任务执行" + (manual ? "(手动)" : "") + ":", t.task_type, "->", r.status, r.resultMsg || r.error || "");
  return r;
}

async function tick() {
  var rows;
  try {
    rows = await mysql.query("SELECT * FROM scheduled_tasks WHERE status=1 AND next_run_at IS NOT NULL AND next_run_at <= NOW()");
  } catch (e) { return; }
  for (var i = 0; i < rows.length; i++) {
    await executeTask(rows[i], false);
  }
}

// 手动立即执行一次（任务中心「立即执行」按钮）：跳过排期，执行并记日志
async function runTaskNow(id) {
  var t = await mysql.taskGetById(id);
  if (!t) return { status: "failed", error: "任务不存在" };
  return await executeTask(t, true);
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

module.exports = { start, stop, tick, nextRunAt, runTaskNow, TASK_TYPES };
