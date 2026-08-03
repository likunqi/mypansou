// scripts/_dryrun_cleanup.js — 只读检查 + 试运行清理（不删任何东西）
(async () => {
  const { dec } = require("../lib/crypto");
  const store = require("../lib/store");
  const mysql = require("../lib/mysql");
  const quark = require("../lib/quark");

  const cfg = await store.getConfig();
  const cookieObj = await store.getCookiesObj();
  let qCookie = "";
  if (cookieObj.quark) { try { qCookie = dec(cookieObj.quark, cfg.encKey); } catch (e) {} }
  if (!qCookie) { console.log("夸克 Cookie 未配置"); process.exit(1); }

  // 1. pansou 目录文件（只读）
  const pansouFid = await quark.ensureDir(qCookie, "pansou", "0");
  const files = await quark.listDir(pansouFid, qCookie);
  console.log("pansou 目录 fid:", pansouFid, "文件数:", files.length);
  if (files.length) {
    const f0 = files[0];
    console.log("样本文件字段:", JSON.stringify({ fid: f0.fid, file_name: f0.file_name, file_type: f0.file_type, created_at: f0.created_at, created_at_type: typeof f0.created_at }));
  }

  // 2. 今天 00:00 截点
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const cutoff = now.getTime();
  const toDelete = files.filter((f) => { const ct = Number(f.created_at); return ct > 0 && ct < cutoff; });
  console.log("今天 00:00:", new Date(cutoff).toLocaleString("zh-CN", { hour12: false }));
  console.log("待删文件数（今天之前）:", toDelete.length);
  toDelete.slice(0, 10).forEach((f) => console.log("  待删:", f.file_name || f.fid, "created_at=", f.created_at));

  // 3. DB 待清理记录数（只读）
  const hist = await mysql.query("SELECT COUNT(*) AS c FROM transfer_history WHERE created_at < ?", [new Date(cutoff).toISOString().slice(0,19).replace("T"," ")]);
  const cache = await mysql.query("SELECT COUNT(*) AS c FROM transfer_cache WHERE created_at < ?", [new Date(cutoff).toISOString().slice(0,19).replace("T"," ")]);
  console.log("今天之前的历史记录:", hist[0].c, "条；缓存记录:", cache[0].c, "条");

  await mysql.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
