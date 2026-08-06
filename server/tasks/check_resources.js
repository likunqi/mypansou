// server/tasks/check_resources.js — 资源链接定时重测
// 策略：每次取「未检测 或 last_checked_at 超过 days 天」的资源 batch_size 条（默认 3000）并发重测
//  - 夸克走官方 token 接口、其他网盘 HTTP+失效词（checkLinkAvail）
//  - 并发池（默认 20）控制网络压力；uncertain（网络异常）跳过不覆盖已有状态
//  - taskConfig.batch_size / concurrency / days 可调；time 控制每日执行时间
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const { checkLinkAvail } = require("../handlers/check");

// 超时守卫：个别链接（如夸克重定向链）可能让请求挂起，12s 强制返回
function withTimeout(p, ms) {
  return Promise.race([p, new Promise(function (res) { setTimeout(function () { res({ valid: false, error: "timeout_guard", uncertain: true }); }, ms); })]);
}

async function run(taskConfig, task) {
  var batch = Math.min(Math.max(parseInt((taskConfig && taskConfig.batch_size) || 300, 10) || 300, 1), 10000);
  var days = parseInt((taskConfig && taskConfig.days) || "3", 10) || 3;
  var concurrency = Math.min(Math.max(parseInt((taskConfig && taskConfig.concurrency) || 20, 10) || 20, 1), 50);
  var rows = await mysql.query(
    "SELECT id, url, title, password FROM resources WHERE status=1 AND (last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(), INTERVAL ? DAY)) ORDER BY (last_checked_at IS NULL) DESC, id DESC LIMIT ?",
    [days, batch]);
  if (!rows.length) return { status: "ok", resultMsg: "无待重测资源（近 " + days + " 天内均已检测）" };

  var done = 0, invalid = 0, uncertain = 0, errs = [];
  // 分批并发（每批 concurrency 条），超时守卫防挂起
  for (var i = 0; i < rows.length; i += concurrency) {
    var seg = rows.slice(i, i + concurrency);
    await Promise.all(seg.map(async function (r) {
      try {
        var cr = await withTimeout(checkLinkAvail(r.url, 5, r.password || ""), 12000);
        done++;
        if (cr.uncertain) { uncertain++; return; } // 网络异常不覆盖已有状态
        await store.resourceUpdate(r.id, {
          link_valid: cr.valid ? 1 : 0,
          check_message: cr.valid ? ("HTTP " + (cr.status || "ok")) : (cr.error || ("HTTP " + (cr.status || "?"))),
          last_checked_at: new Date(),
        });
        if (!cr.valid) invalid++;
      } catch (e) { done++; errs.push(r.id + ":" + e.message); }
    }));
  }
  var rem = await mysql.query(
    "SELECT COUNT(*) c FROM resources WHERE status=1 AND (last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(), INTERVAL ? DAY))",
    [days]);
  var resultMsg = "本批重测 " + done + " 条（失效 " + invalid + " 条" + (uncertain ? "，跳过 " + uncertain + " 条网络异常" : "") + "）" + (errs.length ? "，失败 " + errs.length + " 条" : "") + "，剩余待重测 " + rem[0].c + " 条";
  return { status: done ? "ok" : "failed", resultMsg: resultMsg, error: errs.length ? errs[0] : "" };
}

module.exports = { run };
