// server/tasks/check_resources.js — 资源链接定时重测
// 策略：每次取「未检测 或 last_checked_at 超过 days 天」的资源 batch_size 条（默认 50）逐个重测
//  - 复用 checkLinkAvail（HTTP 状态码 + 页面内容失效关键词双重判断）
//  - 结果写回 resources.link_valid / check_message / last_checked_at
//  - taskConfig.batch_size 可调每批数量；taskConfig.days 可调重测周期（默认 3 天）；time 控制每日执行时间
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const { checkLinkAvail } = require("../handlers/check");

async function run(taskConfig, task) {
  var batch = Math.min(Math.max(parseInt((taskConfig && taskConfig.batch_size) || 50, 10) || 50, 1), 100);
  var days = parseInt((taskConfig && taskConfig.days) || "3", 10) || 3;
  var rows = await mysql.query(
    "SELECT id, url, title, password FROM resources WHERE status=1 AND (last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(), INTERVAL ? DAY)) ORDER BY (last_checked_at IS NULL) DESC, id DESC LIMIT ?",
    [days, batch]);
  if (!rows.length) return { status: "ok", resultMsg: "无待重测资源（近 " + days + " 天内均已检测）" };

  var done = 0, invalid = 0, uncertain = 0, errs = [];
  for (var i = 0; i < rows.length; i++) {
    try {
      var cr = await checkLinkAvail(rows[i].url, 5, rows[i].password || "");
      if (cr.uncertain) { uncertain++; continue; } // 网络异常不覆盖已有状态
      await store.resourceUpdate(rows[i].id, {
        link_valid: cr.valid ? 1 : 0,
        check_message: cr.valid ? ("HTTP " + (cr.status || "ok")) : (cr.error || ("HTTP " + (cr.status || "?"))),
        last_checked_at: new Date(),
      });
      done++;
      if (!cr.valid) invalid++;
    } catch (e) { errs.push(rows[i].id + ":" + e.message); }
  }
  var rem = await mysql.query(
    "SELECT COUNT(*) c FROM resources WHERE status=1 AND (last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(), INTERVAL ? DAY))",
    [days]);
  var resultMsg = "本批重测 " + done + " 条（失效 " + invalid + " 条" + (uncertain ? "，跳过 " + uncertain + " 条网络异常" : "") + "）" + (errs.length ? "，失败 " + errs.length + " 条" : "") + "，剩余待重测 " + rem[0].c + " 条";
  return { status: done ? "ok" : "failed", resultMsg: resultMsg, error: errs.length ? errs[0] : "" };
}

module.exports = { run };
