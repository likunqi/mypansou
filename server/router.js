const { cors, json, serveStatic, logger, getClientIp, injectSiteMeta } = require("./middleware");
const { initData } = require("../lib/storage");
const auth = require("../lib/auth");
const rateLimit = require("../lib/rate-limit");

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
const categories = require("./handlers/categories");
const feedback = require("./handlers/feedback");

async function handleRequest(req, res) {
  logger(req, res);
  var method = req.method, url = req.url;
  var urlPath = new URL(url, "http://" + req.headers.host).pathname;
  res._req = req; // 供 json()/pansou 做 CORS 同源白名单判断

  if (method === "OPTIONS") return cors(req, res);

  // ---- 公开接口 IP 限流（上线加固，防刷）----
  var ip = getClientIp(req);
  var lim = null;
  if (urlPath === "/api/submit/resource" && method === "POST") lim = ["submit", 5];
  else if (urlPath === "/api/feedback" && method === "POST") lim = ["feedback", 10];
  else if (urlPath === "/api/search/record" && method === "POST") lim = ["record", 30];
  else if (urlPath === "/api/check/links" && method === "POST") lim = ["check", 20];
  else if (urlPath === "/api/check/local" && method === "POST") lim = ["check", 20];
  else if (urlPath === "/api/transfer/save" && method === "POST") lim = ["transfer", 5];
  else if (urlPath === "/api/transfer/history" && method === "GET") lim = ["transfer_hist", 20];
  else if (urlPath === "/api/transfer/history/delete" && method === "POST") lim = ["transfer_hist", 10];
  else if (urlPath === "/api/transfer/history/clear" && method === "POST") lim = ["transfer_hist", 10];
  else if (urlPath.startsWith("/api/pansou/") && method === "GET") lim = ["pansou", 60];
  if (lim) {
    var rl = rateLimit.limit(ip, lim[0], lim[1]);
    if (!rl.ok) {
      json(res, 429, { error: "rate_limited", retryAfter: rl.retryAfter, message: "操作太频繁，请 " + rl.retryAfter + " 秒后再试" });
      return;
    }
  }

  try {
    // Hot trending
    if (urlPath === "/api/hot/trending" && method === "GET") return await hot.getTrending(req, res);
    if (urlPath === "/api/hot/keywords" && method === "GET") return await hot.getKeywords(req, res);
    if (urlPath === "/api/hot/resources" && method === "GET") return await hot.getHotResources(req, res);
    if (urlPath === "/api/hot/stats" && method === "GET") return await hot.getStats(req, res);
    if (urlPath === "/api/hot/latest" && method === "GET") return await hot.getLatest(req, res);
    if (urlPath === "/api/hot/site" && method === "GET") return await hot.getSiteInfo(req, res);
    // 失效反馈（公开提交，无需登录）
    if (urlPath === "/api/feedback" && method === "POST") return await feedback.submit(req, res);

    // Search keyword record (front-end fire-and-forget)
    if (urlPath === "/api/search/record" && method === "POST") return await hot.recordSearch(req, res);

    // Link availability check
    if (urlPath === "/api/check/links" && method === "POST") return await check.handler(req, res);
    if (urlPath === "/api/check/local" && method === "POST") return await check.localCheck(req, res);

    // Pansou proxy
    if (urlPath.startsWith("/api/pansou/") && method === "GET") return await pansou.proxyPansou(req, res);

    // Multi-source aggregate search
    if (urlPath === "/api/multi/search" && method === "GET") return await multi.multiSearch(req, res);
    if (urlPath === "/api/multi/sources" && method === "GET") return await multi.sourceList(req, res);

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
      if (/^\/api\/admin\/sources\/\d+\/context$/.test(urlPath) && method === "GET") return await sources.context(req, res);

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
      if (urlPath === "/api/admin/keywords/collect" && method === "POST") return await hot.adminKeywordCollect(req, res);
      if (urlPath === "/api/admin/keywords/sort" && method === "POST") return await hot.adminKeywordSort(req, res);
      if (/^\/api\/admin\/keywords\/\d+$/.test(urlPath) && method === "POST") return await hot.adminKeywordUpdate(req, res);
      if (/^\/api\/admin\/keywords\/\d+\/delete$/.test(urlPath) && method === "POST") return await hot.adminKeywordDelete(req, res);

      // 资源热榜管理（hot_rankings 手动配置）
      if (urlPath === "/api/admin/hot/list" && method === "GET") return await hot.adminHotList(req, res);
      if (urlPath === "/api/admin/hot/ranked-ids" && method === "GET") return await hot.adminHotRankedIds(req, res);
      if (urlPath === "/api/admin/hot/add" && method === "POST") return await hot.adminHotAdd(req, res);
      if (urlPath === "/api/admin/hot/sort" && method === "POST") return await hot.adminHotSaveSort(req, res);
      if (urlPath === "/api/admin/hot/remove" && method === "POST") return await hot.adminHotRemove(req, res);

      // 失效反馈管理
      if (urlPath === "/api/admin/feedback" && method === "GET") return await feedback.adminList(req, res);
      if (/^\/api\/admin\/feedback\/\d+$/.test(urlPath) && method === "POST") return await feedback.adminHandle(req, res);

      // Resource management
      if (urlPath === "/api/admin/dashboard" && method === "GET") return await admin.dashboard(req, res);
      if (urlPath === "/api/admin/siteconfig" && method === "GET") return await admin.getSiteConfig(req, res);
      if (urlPath === "/api/admin/siteconfig" && method === "POST") return await admin.saveSiteConfig(req, res);
      if (urlPath === "/api/admin/dbconfig" && method === "GET") return await admin.getDbConfig(req, res);
      if (urlPath === "/api/admin/dbconfig" && method === "POST") return await admin.saveDbConfig(req, res);
      if (urlPath === "/api/admin/config/export" && method === "GET") return await admin.configExport(req, res);
      if (urlPath === "/api/admin/config/import" && method === "POST") return await admin.configImport(req, res);
      if (urlPath === "/api/admin/resources/export" && method === "GET") return await admin.resourceExport(req, res);
      if (urlPath === "/api/admin/resources" && method === "GET") return await resource.adminList(req, res);
      if (urlPath === "/api/admin/resources" && method === "POST") return await resource.adminAdd(req, res);
      if (/^\/api\/admin\/resources\/\d+$/.test(urlPath) && method === "POST") return await resource.adminUpdate(req, res);
      if (/^\/api\/admin\/resources\/\d+$/.test(urlPath) && method === "DELETE") return await resource.adminDelete(req, res);
      if (urlPath === "/api/admin/resources/batch-delete" && method === "POST") return await resource.adminDeleteBatch(req, res);
      if (urlPath === "/api/admin/resources/optimize" && method === "POST") return await resource.adminOptimize(req, res);
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
      if (urlPath === "/api/admin/tg/disks" && method === "GET") return await tg.getDisks(req, res);
      if (urlPath === "/api/admin/tg/disks" && method === "POST") return await tg.saveDisks(req, res);
      if (urlPath === "/api/admin/tg/instances/test" && method === "POST") return await tg.testInstances(req, res);
      if (urlPath === "/api/admin/tg/ai-generate" && method === "POST") return await tg.aiGenerate(req, res);

      // 分类管理
      if (urlPath === "/api/admin/categories" && method === "GET") return await categories.list(req, res);
      if (urlPath === "/api/admin/categories" && method === "POST") return await categories.add(req, res);
      if (/^\/api\/admin\/categories\/\d+$/.test(urlPath) && method === "POST") return await categories.update(req, res);
      if (/^\/api\/admin\/categories\/\d+$/.test(urlPath) && method === "DELETE") return await categories.del(req, res);

      json(res, 404, { error: "admin_route_not_found" });
      return;
    }

    // robots.txt（动态生成，Sitemap 指向当前域名）
    if (urlPath === "/robots.txt" && method === "GET") {
      var host = req.headers.host || "localhost";
      var proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() === "https" ? "https" : "http";
      var base = proto + "://" + host;
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(
        "User-agent: *\n" +
        "Allow: /\n" +
        "Disallow: /api/\n" +
        "Disallow: /admin.html\n" +
        "Disallow: /bigscreen.html\n" +
        "Sitemap: " + base + "/sitemap.xml\n"
      );
      return;
    }

    // sitemap.xml：首页 + 搜索页 + 热门资源标题搜索 URL（从资源库取，500 条内）
    if (urlPath === "/sitemap.xml" && method === "GET") {
      var host2 = req.headers.host || "localhost";
      var proto2 = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() === "https" ? "https" : "http";
      var base2 = proto2 + "://" + host2;
      var items = [{ loc: base2 + "/", pri: "1.0", freq: "daily" }, { loc: base2 + "/search", pri: "0.9", freq: "daily" }];
      try {
        var mysql2 = require("../lib/mysql");
        var rows = await mysql2.query(
          "SELECT title FROM resources WHERE status=1 AND title IS NOT NULL AND title<>'' ORDER BY search_count DESC, id DESC LIMIT 400"
        );
        (rows || []).forEach(function (r) {
          var q = encodeURIComponent(String(r.title).trim());
          items.push({ loc: base2 + "/search?q=" + q, pri: "0.6", freq: "weekly" });
        });
      } catch (e) { /* MySQL 不可用则只输出基础 URL */ }
      var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      items.forEach(function (it) {
        xml += "  <url><loc>" + it.loc + "</loc><changefreq>" + it.freq + "</changefreq><priority>" + it.pri + "</priority></url>\n";
      });
      xml += "</urlset>\n";
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(xml);
      return;
    }

    // Search page（动态注入 TDK，SEO）
    if (urlPath === "/search" && method === "GET") {
      var fs2 = require("fs");
      var p2 = require("path");
      var fp2 = p2.join(__dirname, "..", "public", "search.html");
      try {
        var html2 = fs2.readFileSync(fp2, "utf8");
        var store2 = require("../lib/store");
        var site = await store2.getSiteConfig().catch(function () { return null; });
        var out = injectSiteMeta(html2, site || {});
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(out);
      } catch (e) {
        json(res, 404, { error: "search_page_not_found" });
      }
      return;
    }

    // Static files
    serveStatic(res, urlPath);
  } catch (e) {
    console.error("Unhandled:", e.stack || e.message);
    json(res, 500, { error: "internal_error", message: e.message });
  }
}

module.exports = { handleRequest };
