// server/tasks/refresh_cookies.js — Cookie 状态刷新任务
// 遍历 cookies 表所有启用账号，逐个验证有效性（夸克调文件列表 / 百度调配额），
// 更新 is_valid / last_tested_at；失效账号写入 resultMsg 明细（供后台日志查看），
// 预留 webhook 通知 hook（后期接 magicpush）。
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const crypto = require("../../lib/crypto");
const { fetchHttps } = require("../middleware");
const { testCookieValue } = require("../handlers/admin");

async function run(taskConfig, task) {
  var accounts = await store.getCookieAccounts();
  var enabled = (accounts || []).filter(function (a) { return a.enabled !== false; });
  if (!enabled.length) return { status: "ok", resultMsg: "没有启用中的 Cookie 账号" };

  var cfg = await store.getConfig();
  var key = cfg.encKey || "x";
  var okN = 0, badN = 0, badDetail = [], skipped = [];

  for (var i = 0; i < enabled.length; i++) {
    var a = enabled[i];
    var plain = "";
    try { plain = crypto.dec(a.encrypted, key); } catch (e) {}
    if (!plain) {
      badN++;
      badDetail.push(a.provider + (a.name ? "(" + a.name + ")" : "") + ":解密失败");
      continue;
    }
    var t = null;
    try { t = await testCookieValue(a.provider, plain); } catch (e) {
      badN++;
      badDetail.push(a.provider + (a.name ? "(" + a.name + ")" : "") + ":" + e.message);
      continue;
    }
    await store.cookieUpdate(a.id, { is_valid: t.valid ? 1 : 0, last_tested_at: new Date() });
    if (t.valid) okN++;
    else { badN++; badDetail.push(a.provider + (a.name ? "(" + a.name + ")" : "") + ":" + (t.detail || "invalid")); }
  }

  var msg = "共 " + enabled.length + " 个账号：有效 " + okN + "，失效 " + badN;
  if (badDetail.length) msg += " ｜ " + badDetail.join("；");
  return { status: badN ? "ok" : "ok", resultMsg: msg, invalidCount: badN };
}

module.exports = { run };
