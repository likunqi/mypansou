// server/tasks/cleanup.js — 每日转存资源清理任务
// 策略（用户确认）：保当天，删更早。
//  - 夸克 pansou 目录中「今天 00:00 之前」转存的文件 → 删除
//  - 转存历史 / 转存缓存 → 只留当天记录
//  - taskConfig.dryRun = true 时只统计不删除（试运行）
const { dec } = require("../../lib/crypto");
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const quark = require("../../lib/quark");

async function run(taskConfig, task) {
  var dryRun = !!(taskConfig && taskConfig.dryRun);
  var cfg = await store.getConfig();
  var cookieObj = await store.getCookiesObj();
  var qCookie = "";
  if (cookieObj.quark) { try { qCookie = dec(cookieObj.quark, cfg.encKey); } catch (e) {} }
  if (!qCookie) return { status: "failed", error: "夸克 Cookie 未配置，跳过清理" };

  // 今天 00:00（本地）为截点
  var now = new Date(); now.setHours(0, 0, 0, 0);
  var cutoff = now.getTime();

  // 1. 列出 pansou 目录文件
  var pansouFid = await quark.ensureDir(qCookie, "pansou", "0");
  var files = await quark.listDir(pansouFid, qCookie);
  var toDelete = files.filter(function (f) {
    var ct = Number(f.created_at);
    return ct > 0 && ct < cutoff;
  });

  // 2. 删除今天之前的文件
  if (!dryRun && toDelete.length > 0) {
    await quark.deleteFiles(toDelete.map(function (f) { return f.fid; }), qCookie);
  }

  // 3. 清理 DB：历史/缓存只留当天
  if (!dryRun) {
    try { await mysql.historyDeleteBefore(cutoff); } catch (e) { console.error("[cleanup] history:", e.message); }
    try { await mysql.cacheDeleteBefore(cutoff); } catch (e) { console.error("[cleanup] cache:", e.message); }
  }

  var names = toDelete.slice(0, 5).map(function (f) { return f.file_name || f.fid; }).join("、");
  var resultMsg = (dryRun ? "[试运行] " : "") + "pansou 目录共 " + files.length + " 个文件，待删（今天之前）" + toDelete.length + " 个" +
    (toDelete.length ? "（" + names + (toDelete.length > 5 ? " 等" : "") + "）" : "");
  return { status: "ok", resultMsg: resultMsg };
}

module.exports = { run };
