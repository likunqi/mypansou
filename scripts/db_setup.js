// scripts/db_setup.js — 用 mysql2 在 pansou 库执行 sql/init/002_schema_v2.sql 建表
// 用法: node scripts/db_setup.js
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function loadConfig() {
  var fp = path.join(__dirname, "..", "data", "db.config.json");
  var f = {};
  try { f = JSON.parse(fs.readFileSync(fp, "utf8")); } catch (e) {}
  return {
    host: process.env.PANSOU_MYSQL_HOST || f.host || "192.168.1.65",
    port: parseInt(process.env.PANSOU_MYSQL_PORT || f.port || "3306", 10),
    user: process.env.PANSOU_MYSQL_USER || f.user || "pansou",
    password: process.env.PANSOU_MYSQL_PASSWORD || f.password || "Srcloud@216",
    database: process.env.PANSOU_MYSQL_DATABASE || f.database || "pansou",
  };
}

(async () => {
  var cfg = loadConfig();
  var sqlPath = path.join(__dirname, "..", "sql", "init", "002_schema_v2.sql");
  var raw = fs.readFileSync(sqlPath, "utf8");

  // 去掉 -- 行注释
  var lines = raw.split("\n").map(function (l) {
    return l.includes("--") ? l.split("--")[0] : l;
  });
  var stmts = lines.join("\n").split(";").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });

  console.log("连接 " + cfg.host + ":" + cfg.port + "/" + cfg.database + " ...");
  var conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    database: cfg.database, charset: "utf8mb4",
  });

  var ok = 0;
  for (var i = 0; i < stmts.length; i++) {
    try { await conn.query(stmts[i]); ok++; }
    catch (e) {
      console.error("STMT ERROR:", e.message);
      console.error("SQL head:", stmts[i].slice(0, 140));
    }
  }
  var cnt = await conn.query("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=?", [cfg.database]);
  var tables = await conn.query("SHOW TABLES");
  console.log("成功执行语句:", ok, "/", stmts.length);
  console.log("pansou 库表数量:", cnt[0][0].c);
  console.log("表清单:", tables[0].map(function (r) { return Object.values(r)[0]; }).join(", "));
  await conn.end();
})().catch(function (e) { console.error("FATAL:", e.message); process.exit(1); });
