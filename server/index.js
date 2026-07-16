const http = require("http");
const { handleRequest } = require("./router");
const { initData } = require("../lib/storage");

initData();

const PORT = process.env.PORT || 3090;

var server = http.createServer(handleRequest);
server.listen(PORT, function() {
  console.log("  Frontend: http://localhost:" + PORT);
  console.log("  Douban: http://localhost:" + PORT + "/api/douban/hot");
  console.log("  Admin:  http://localhost:" + PORT + "/admin.html");
});
