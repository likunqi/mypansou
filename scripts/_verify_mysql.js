// scripts/_verify_mysql.js — 迁移后全面验证（临时）
(async () => {
  const base = "http://localhost:3090";
  const l = await fetch(base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "admin123" }) });
  const lj = await l.json();
  console.log("1. login:", l.status, lj.token ? "OK" : "FAIL");
  if (!lj.token) { console.log("停止：登录失败"); return; }
  const H = { Authorization: "Bearer " + lj.token };
  const st = await (await fetch(base + "/api/admin/status", { headers: H })).json();
  console.log("2. admin/status:", JSON.stringify(st));
  const c = await (await fetch(base + "/api/admin/cache", { headers: H })).json();
  console.log("3. admin/cache:", JSON.stringify(c));
  const db = await (await fetch(base + "/api/admin/db", { headers: H })).json();
  console.log("4. admin/db:", JSON.stringify(db));
  const hi = await (await fetch(base + "/api/transfer/history")).json();
  console.log("5. history records:", hi.records ? hi.records.length : 0, JSON.stringify((hi.records || [])[0] || null));
  const ht = await fetch(base + "/api/hot/trending");
  console.log("6. hot/trending:", ht.status);

  // 7. store 层读写回环（MySQL 主存储）
  const store = require("../lib/store");
  await store.saveCookie("__test", "ENC_TEST_VALUE");
  const ck = await store.getCookiesObj();
  console.log("7. cookie roundtrip:", ck.__test === "ENC_TEST_VALUE" ? "OK" : "FAIL");
  await store.cacheSet("http://test.example/1", { newUrl: "http://new.example/1", pwd: "abcd", note: "n" });
  const cg = await store.cacheGet("http://test.example/1");
  console.log("8. cache roundtrip:", cg && cg.newUrl === "http://new.example/1" ? "OK" : "FAIL");
  await store.historyAdd({ originalUrl: "http://test.example/2", newUrl: "http://new.example/2", pwd: "", type: "quark", title: "测试", success: true, createdAt: Date.now() });
  const hl = await store.historyList(50);
  console.log("9. history list (mysql):", hl.length, "条, 首条:", (hl[0] || {}).title);
  const cst = await store.cacheStats();
  console.log("10. cache stats (mysql):", JSON.stringify(cst));

  // 清理测试数据 + 关闭连接池
  const mysql = require("../lib/mysql");
  try { await mysql.execute("DELETE FROM cookies WHERE provider=?", ["__test"]); } catch (e) {}
  try { await mysql.execute("DELETE FROM transfer_cache WHERE original_url=?", ["http://test.example/1"]); } catch (e) {}
  try { await mysql.execute("DELETE FROM transfer_history WHERE original_url=?", ["http://test.example/2"]); } catch (e) {}
  await mysql.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
