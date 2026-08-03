const http = require("http");
const { handleRequest } = require("./router");
const { initData } = require("../lib/storage");
const mysql = require("../lib/mysql");
const store = require("../lib/store");
const scheduler = require("../lib/scheduler");

initData();

const PORT = process.env.PORT || 3090;

var server = http.createServer(handleRequest);
server.listen(PORT, function() {
  console.log("  Frontend: http://localhost:" + PORT);
  console.log("  Douban: http://localhost:" + PORT + "/api/douban/hot");
  console.log("  Admin:  http://localhost:" + PORT + "/admin.html");
});

// MySQL 接入探活（非阻塞，失败自动降级 JSON 存储，不影响启动）+ 一次性数据迁移 + 定时任务
mysql.init()
  .then(function(r) { return store.migrateFromJson(); })
  .then(function(m) {
    if (m && m.migrated) console.log("[mysql] JSON->MySQL 迁移完成:", m.log.join(", "));
  })
  .catch(function(e) {
    console.log("[mysql] 未连接（使用 JSON 存储兜底）:", e.message);
  })
  .finally(function() {
    scheduler.start(); // 调度器自带 MySQL 重试，服务恢复后自动接管
  });
