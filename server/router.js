const { cors, json, serveStatic, logger } = require("./middleware");
const { initData } = require("../lib/storage");
const auth = require("../lib/auth");

const pansou = require("./handlers/pansou");
const hot = require("./handlers/hot");
const check = require("./handlers/check");
const transfer = require("./handlers/transfer");
const admin = require("./handlers/admin");

async function handleRequest(req, res) {
  logger(req, res);
  var method = req.method, url = req.url;
  var urlPath = new URL(url, "http://" + req.headers.host).pathname;

  if (method === "OPTIONS") return cors(req, res);

  try {
    // Hot trending
    if (urlPath === "/api/hot/trending" && method === "GET") return await hot.getTrending(req, res);

    // Link availability check
    if (urlPath === "/api/check/links" && method === "POST") return await check.handler(req, res);

    // Pansou proxy
    if (urlPath.startsWith("/api/pansou/") && method === "GET") return await pansou.proxyPansou(req, res);

    // Transfer (Quark save)
    if (urlPath === "/api/transfer/save" && method === "POST") return await transfer.handler(req, res);
      if (urlPath === "/api/transfer/history" && method === "GET") return await transfer.getHistory(req, res);

    
    // --- Admin API routes ---
    if (urlPath.startsWith("/api/admin/")) {
      if (urlPath === "/api/admin/login" && method === "POST") return await admin.login(req, res);
      var token = (req.headers["authorization"] || "").replace("Bearer ", "");
      if (!auth.check(token)) { json(res, 401, { error: "not_logged_in" }); return; }
      if (urlPath === "/api/admin/logout" && method === "POST") return await admin.logout(req, res);
      if (urlPath === "/api/admin/status" && method === "GET") return await admin.status(req, res);
      if (urlPath === "/api/admin/cookies" && method === "POST") return await admin.saveCookies(req, res);
      if (urlPath === "/api/admin/cookies/test" && method === "POST") return await admin.testCookies(req, res);
      if (urlPath === "/api/admin/cookies/summary" && method === "GET") return await admin.getCookieSummary(req, res);
      if (urlPath === "/api/admin/config" && method === "GET") return await admin.getConfig(req, res);
      if (urlPath === "/api/admin/config" && method === "POST") return await admin.saveConfig(req, res);
      if (urlPath === "/api/admin/cache" && method === "GET") return await admin.cacheInfo(req, res);
      if (urlPath === "/api/admin/cache/clear" && method === "POST") return await admin.clearCache(req, res);
      if (urlPath === "/api/admin/password" && method === "POST") return await admin.changePassword(req, res);      json(res, 404, { error: "admin_route_not_found" });
      return;
    }

    // Search page
    if (urlPath === "/search" && method === "GET") {
      var fs2 = require("fs");
      var p2 = require("path");
      var fp2 = p2.join(__dirname, "..", "public", "search.html");
      try {
        var html2 = fs2.readFileSync(fp2, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html2);
      } catch (e) {
        json(res, 404, { error: "search_page_not_found" });
      }
      return;
    }

        // Static files / SPA fallback
    serveStatic(res, urlPath);
  } catch (e) {
    console.error("Unhandled:", e.stack || e.message);
    json(res, 500, { error: "internal_error", message: e.message });
  }
}

module.exports = { handleRequest };
