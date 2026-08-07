// server/tasks/cleanup.js — 转存资源清理任务
// 策略（用户确认 2026-08-07）：
//  - 遍历所有启用中的夸克 Cookie 账号，逐个清理其 pansou 目录
//  - 保留期 keep_hours（默认 24h）：删「创建超过 keep_hours」的文件（用户有充足时间保存）
//  - 每账号文件数上限 max_files（默认 50）：超了删最老的（防堆积，容量兜底）
//  - 联动清缓存：删文件时同步删 transfer_cache 中创建时间匹配的记录（避免用户拿到失效链接）
//  - 转存历史 / 转存缓存（DB + JSON）→ 按保留期清理
//  - taskConfig.dryRun = true 时只统计不删除（试运行）
const { dec } = require("../../lib/crypto");
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const quark = require("../../lib/quark");

function pad(n) { return (n < 10 ? "0" : "") + n; }
function toSqlDt(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

async function run(taskConfig, task) {
  var dryRun = !!(taskConfig && taskConfig.dryRun);
  var keepHours = parseInt((taskConfig && taskConfig.keep_hours) || "24", 10) || 24;
  var maxFiles = parseInt((taskConfig && taskConfig.max_files) || "50", 10) || 50;
  var cfg = await store.getConfig();
  var accounts = await store.getCookieAccounts();
  var qAccounts = (accounts || []).filter(function (a) {
    return a.provider === "quark" && a.enabled !== false;
  });
  if (!qAccounts.length) return { status: "failed", error: "没有启用中的夸克 Cookie 账号，跳过清理" };

  // 保留期截点：now - keepHours
  var cutoffMs = Date.now() - keepHours * 3600 * 1000;
  var cutoffSql = toSqlDt(new Date(cutoffMs));
  var deletedFileTimes = []; // 被删文件创建时间（ms），用于联动清缓存

  var parts = [];
  var totalFiles = 0, totalToDel = 0;
  for (var i = 0; i < qAccounts.length; i++) {
    var acc = qAccounts[i];
    var qCookie = "";
    try { qCookie = dec(acc.encrypted, cfg.encKey); } catch (e) {}
    if (!qCookie) { parts.push((acc.name || acc.provider) + ":解密失败"); continue; }
    try {
      var pansouFid = await quark.ensureDir(qCookie, "pansou", "0");
      var files = await quark.listDir(pansouFid, qCookie);
      // 按创建时间升序（最老在前）
      var ordered = (files || []).slice().sort(function (a, b) { return (Number(a.created_at) || 0) - (Number(b.created_at) || 0); });
      // 规则1：保留期内（创建 >= cutoff）的都要留；规则2：即使都在保留期内，超过 max_files 删最老的
      var keep = [];
      var toDelete = [];
      var maxKeep = Math.min(ordered.length, maxFiles); // 最多保留 maxFiles 个（最新的）
      var keepCount = 0;
      for (var j = 0; j < ordered.length; j++) {
        var f = ordered[j];
        var ct = Number(f.created_at);
        var isOld = ct > 0 && ct < cutoffMs;
        var isOver = keepCount >= maxKeep; // 已保留够上限了
        if (isOld || isOver) toDelete.push(f);
        else { keep.push(f); keepCount++; }
      }
      totalFiles += ordered.length; totalToDel += toDelete.length;
      if (!dryRun && toDelete.length > 0) {
        await quark.deleteFiles(toDelete.map(function (f) { return f.fid; }), qCookie);
        toDelete.forEach(function (f) { deletedFileTimes.push(Number(f.created_at)); });
      }
      var names = toDelete.slice(0, 3).map(function (f) { return f.file_name || f.fid; }).join("、");
      parts.push((acc.name || acc.provider) + ":文件 " + ordered.length + " 删 " + toDelete.length +
        (toDelete.length ? "(" + names + (toDelete.length > 3 ? " 等" : "") + ")" : ""));
    } catch (e) {
      parts.push((acc.name || acc.provider) + ":失败(" + e.message + ")");
    }
  }

  // 联动清缓存：被删文件创建时间匹配的 transfer_cache 记录（转存时缓存与文件同刻写入）
  if (!dryRun && deletedFileTimes.length) {
    try {
      var minT = Math.min.apply(null, deletedFileTimes), maxT = Math.max.apply(null, deletedFileTimes);
      // ±5 分钟窗口，覆盖同批转存的所有缓存
      var winStart = toSqlDt(new Date(minT - 5 * 60 * 1000));
      var winEnd = toSqlDt(new Date(maxT + 5 * 60 * 1000));
      var del = await mysql.execute(
        "DELETE FROM transfer_cache WHERE created_at BETWEEN ? AND ?", [winStart, winEnd]);
      console.log("[cleanup] 联动清缓存", del.affectedRows, "条（文件", deletedFileTimes.length, "个）");
    } catch (e) { console.error("[cleanup] cache link:", e.message); }
  }

  // DB 历史/缓存按保留期清理（只留 keep_hours 内）
  if (!dryRun) {
    try { await mysql.historyDeleteBefore(cutoffMs); } catch (e) { console.error("[cleanup] history:", e.message); }
    try { await mysql.cacheDeleteBefore(cutoffMs); } catch (e) { console.error("[cleanup] cache:", e.message); }
  }

  var resultMsg = (dryRun ? "[试运行] " : "") + "夸克账号 " + qAccounts.length + " 个：共 " + totalFiles + " 个文件，删 " + totalToDel +
    "（保留 " + keepHours + "h / 每账号上限 " + maxFiles + "）" +
    (parts.length ? " ｜ " + parts.join("；") : "");
  return { status: "ok", resultMsg: resultMsg };
}

module.exports = { run };
