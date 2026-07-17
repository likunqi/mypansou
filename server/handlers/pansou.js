const { fetchHttps, json } = require("../middleware");
const { rd, PATHS, PANSOU_BASE } = require("../../lib/storage");

async function proxyPansou(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var cfg = rd(PATHS.CFG, {});
  var base = cfg.pansouBase || PANSOU_BASE;
  var targetPath = u.pathname.replace(/^\/api\/pansou/, "/api") + u.search;
  var lastError = null;
  for (var attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) await new Promise(function(r) { setTimeout(r, 1000 * attempt); });
    try {
      var pr = await fetchHttps(base, targetPath);
      if (pr.status >= 500) { lastError = { status: pr.status, body: pr.body }; continue; }
      try { JSON.parse(pr.body); } catch (pe) {
        lastError = { error: "pansou_api_error", message: "pansou returned non-JSON" };
        continue;
      }
      res.writeHead(pr.status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(pr.body);
      return;
    } catch (e) {
      lastError = { error: "pansou_proxy_error", message: e.message };
      continue;
    }
  }
  json(res, 502, lastError || { error: "pansou_error", message: "request failed after retries" });
}

module.exports = { proxyPansou };
