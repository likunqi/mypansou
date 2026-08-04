const { cors, json, serveStatic, logger } = require("./middleware");
const { initData } = require("../lib/storage");
const auth = require("../lib/auth");

const pansou = require("./handlers/pansou");
const hot = require("./handlers/hot");
const check = require("./handlers/check");
const transfer = require("./handlers/transfer");
const admin = require("./handlers/admin");
const resource = require("./handlers/resource");
const importH = require("./handlers/import");
const crawler = require("./handlers/crawler");
const ai = require("./handlers/ai");
const multi = require("./handlers/multi");
const sources = require("./handlers/sources");
const tasks = require("./handlers/tasks");
const tg = require("./handlers/tg");

async function handleRequest(req, res) {
  logger(req, res);
  var method = req.method, url = req.url;
  var urlPath = new URL(url, "http://" + req.headers.host).pathname;

  if (method === "OPTIONS") return cors(req, res);

  try {
    // Hot trending
    if (urlPath === "/api/hot/trending" && method === "GET") return await hot.getTrending(req, res);
    if (urlPath === "/api/hot/keywords" && method === "GET") return await hot.getKeywords(req, res);
    if (urlPath === "/api/hot/resources" && method === "GET") return await hot.getHotResources(req, res);
    if (urlPath === "/api/hot/stats" && method === "GET") return await hot.getStats(req, res);

    // Search keyword record (front-end fire-and-forget)
    if (urlPath === "/api/search/record" && method === "POST") return await hot.recordSearch(req, res);

    // Link availability check
    if (urlPath === "/api/check/links" && method === "POST") return await check.handler(req, res);
    if (urlPath === "/api/check/local" && method === "POST") return await check.localCheck(req, res);

    // Pansou proxy
    if (urlPath.startsWith("/api/pansou/") && method === "GET") return await pansou.proxyPansou(req, res);

    // Multi-source aggregate search
    if (urlPath === "/api/multi/search" && method === "GET") return await multi.multiSearch(req, res);

    // Transfer (Quark save)
    if (urlPath === "/api/transfer/save" && method === "POST") return await transfer.handler(req, res);
    if (urlPath === "/api/transfer/history" && method === "GET") return await transfer.getHistory(req, res);
    if (urlPath === "/api/transfer/history/delete" && method === "POST") return await transfer.historyDelete(req, res);
    if (urlPath === "/api/transfer/history/clear" && method === "POST") return await transfer.historyClear(req, res);

    // Resource pipeline: submit / local search / report
    if (urlPath === "/api/submit/resource" && method === "POST") return await resource.submitResource(req, res);
    if (urlPath === "/api/search/local" && method === "GET") return await resource.localSearch(req, res);
    if (/^\/api\/resources\/\d+\/report$/.test(urlPath) && method === "POST") return await resource.reportBroken(req, res);

    
    // --- Admin API routes ---
    if (urlPath.startsWith("/api/admin/")) {
      if (urlPath === "/api/admin/login" && method === "POST") return await admin.login(req, res);
      var token = (req.headers["authorization"] || "").replace("Bearer ", "");
      if (!auth.check(token)) { json(res, 401, { error: "not_logged_in" }); return; }
      if (urlPath === "/api/admin/logout" && method === "POST") return await admin.logout(req, res);
      if (urlPath === "/api/admin/status" && method === "GET") return await admin.status(req, res);
      if (urlPath === "/api/admin/cookies" && method === "GET") return await admin.cookieList(req, res);
      if (urlPath === "/api/admin/cookies" && method === "POST") return await admin.cookieAdd(req, res);
      if (urlPath === "/api/admin/cookies/test" && method === "POST") return await admin.cookieTest(req, res);
      if (urlPath === "/api/admin/cookies/summary" && method === "GET") return await admin.getCookieSummary(req, res);
      if (/^\/api\/admin\/cookies\/\d+\/delete$/.test(urlPath) && method === "POST") return await admin.cookieDelete(req, res);
      if (/^\/api\/admin\/cookies\/\d+\/test$/.test(urlPath) && method === "POST") return await admin.cookieTestById(req, res);
      if (/^\/api\/admin\/cookies\/\d+$/.test(urlPath) && method === "POST") return await admin.cookieUpdate(req, res);
      if (urlPath === "/api/admin/config" && method === "GET") return await admin.getConfig(req, res);
      if (urlPath === "/api/admin/config" && method === "POST") return await admin.saveConfig(req, res);
      if (urlPath === "/api/admin/cache" && method === "GET") return await admin.cacheInfo(req, res);
      if (urlPath === "/api/admin/cache/clear" && method === "POST") return await admin.clearCache(req, res);
      if (urlPath === "/api/admin/db" && method === "GET") return await admin.dbStatus(req, res);
      if (urlPath === "/api/admin/password" && method === "POST") return await admin.changePassword(req, res);

      // AI 提炼
      if (urlPath === "/api/admin/ai/config" && method === "GET") return await ai.getConfig(req, res);
      if (urlPath === "/api/admin/ai/config" && method === "POST") return await ai.saveConfig(req, res);
      if (urlPath === "/api/admin/ai/test" && method === "POST") return await ai.test(req, res);
      if (urlPath === "/api/admin/ai/summarize" && method === "POST") return await ai.summarize(req, res);
      if (urlPath === "/api/admin/ai/summaries" && method === "GET") return await ai.list(req, res);
      if (urlPath === "/api/admin/ai/rules" && method === "POST") return await ai.genRules(req, res);
      if (urlPath === "/api/admin/ai/script" && method === "POST") return await ai.genScript(req, res);
      if (urlPath === "/api/admin/sources" && method === "GET") return await sources.list(req, res);
      if (urlPath === "/api/admin/sources/update" && method === "POST") return await sources.update(req, res);

      // 任务中心
      if (urlPath === "/api/admin/tasks" && method === "GET") return await tasks.list(req, res);
      if (urlPath === "/api/admin/tasks" && method === "POST") return await tasks.add(req, res);
      if (urlPath === "/api/admin/task-types" && method === "GET") return await tasks.types(req, res);
      if (/^\/api\/admin\/tasks\/\d+$/.test(urlPath) && method === "POST") return await tasks.update(req, res);
      if (/^\/api\/admin\/tasks\/\d+$/.test(urlPath) && method === "DELETE") return await tasks.del(req, res);
      if (/^\/api\/admin\/tasks\/\d+\/run$/.test(urlPath) && method === "POST") return await tasks.runNow(req, res);
      if (urlPath === "/api/admin/task-logs" && method === "GET") return await tasks.logs(req, res);

      // 热搜词管理
      if (urlPath === "/api/admin/keywords" && method === "GET") return await hot.adminKeywordList(req, res);
      if (urlPath === "/api/admin/keywords" && method === "POST") return await hot.adminKeywordAdd(req, res);
      if (/^\/api\/admin\/keywords\/\d+$/.test(urlPath) && method === "POST") return await hot.adminKeywordUpdate(req, res);
      if (/^\/api\/admin\/keywords\/\d+\/delete$/.test(urlPath) && method === "POST") return await hot.adminKeywordDelete(req, res);

      // Resource management
      if (urlPath === "/api/admin/dashboard" && method === "GET") return await admin.dashboard(req, res);
      if (urlPath === "/api/admin/siteconfig" && method === "GET") return await admin.getSiteConfig(req, res);
      if (urlPath === "/api/admin/siteconfig" && method === "POST") return await admin.saveSiteConfig(req, res);
      if (urlPath === "/api/admin/resources" && method === "GET") return await resource.adminList(req, res);
      if (urlPath === "/api/admin/resources" && method === "POST") return await resource.adminAdd(req, res);
      if (/^\/api\/admin\/resources\/\d+$/.test(urlPath) && method === "POST") return await resource.adminUpdate(req, res);
      if (/^\/api\/admin\/resources\/\d+$/.test(urlPath) && method === "DELETE") return await resource.adminDelete(req, res);
      if (urlPath === "/api/admin/submissions" && method === "GET") return await resource.adminSubmissions(req, res);
      if (/^\/api\/admin\/submissions\/\d+\/approve$/.test(urlPath) && method === "POST") return await resource.adminApprove(req, res);
      if (/^\/api\/admin\/submissions\/\d+\/reject$/.test(urlPath) && method === "POST") return await resource.adminReject(req, res);

      // Import
      if (urlPath === "/api/admin/import/upload" && method === "POST") return await importH.upload(req, res);
      if (urlPath === "/api/admin/import/confirm" && method === "POST") return await importH.confirm(req, res);
      if (urlPath === "/api/admin/import/logs" && method === "GET") return await importH.logs(req, res);

      // Crawler
      if (urlPath === "/api/admin/crawler/sources" && method === "GET") return await crawler.sourceList(req, res);      if (urlPath === "/api/admin/crawler/sources" && method === "POST") return await crawler.sourceAdd(req, res);
      if (/^\/api\/admin\/crawler\/sources\/\d+$/.test(urlPath) && method === "POST") return await crawler.sourceUpdate(req, res);
      if (/^\/api\/admin\/crawler\/sources\/\d+\/delete$/.test(urlPath) && method === "POST") return await crawler.sourceDelete(req, res);
      if (/^\/api\/admin\/crawler\/sources\/\d+\/run$/.test(urlPath) && method === "POST") return await crawler.sourceRun(req, res);
      if (urlPath === "/api/admin/crawler/rules" && method === "GET") return await crawler.ruleList(req, res);
      if (urlPath === "/api/admin/crawler/rules" && method === "POST") return await crawler.ruleAdd(req, res);
      if (/^\/api\/admin\/crawler\/rules\/\d+$/.test(urlPath) && method === "POST") return await crawler.ruleUpdate(req, res);
      if (/^\/api\/admin\/crawler\/rules\/\d+\/delete$/.test(urlPath) && method === "POST") return await crawler.ruleDelete(req, res);
      if (urlPath === "/api/admin/crawler/rules/replace" && method === "POST") return await crawler.ruleReplace(req, res);

      // TG 采集（主力）
      if (urlPath === "/api/admin/tg/settings" && method === "GET") return await tg.getSettings(req, res);
      if (urlPath === "/api/admin/tg/settings" && method === "POST") return await tg.saveSettings(req, res);
      if (urlPath === "/api/admin/tg/batch-add" && method === "POST") return await tg.batchAdd(req, res);
      if (urlPath === "/api/admin/tg/sources" && method === "GET") return await tg.sourceList(req, res);

      json(res, 404, { error: "admin_route_not_found" });
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
