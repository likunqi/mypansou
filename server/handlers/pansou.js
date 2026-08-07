const { fetchHttps, json, corsOrigin } = require("../middleware");
const store = require("../../lib/store");

async function proxyPansou(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var targetPath = u.pathname.replace(/^\/api\/pansou/, "/api") + u.search;
  var bases = await store.getPansouBases();
  var tried = {};
  var lastError = null;
  var attempts = Math.max(bases.length, 3); // 单 host 保留 3 次退避重试，多 host 轮流切换
  for (var attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise(function(r) { setTimeout(r, 1000 * attempt); });
    var picked = store.pickPansouBase(bases.filter(function(h) { return !tried[h.host]; }));
    if (!picked) break;
    tried[picked.host] = 1;
    try {
      var pr = await fetchHttps(picked.host, targetPath);
      if (pr.status >= 500) { lastError = { status: pr.status, body: pr.body }; continue; }
      var parsed;
      try { parsed = JSON.parse(pr.body); } catch (pe) {
        lastError = { error: "pansou_api_error", message: "pansou returned non-JSON" };
        continue;
      }
      // 只保留夸克/百度网盘（NAS 版 pansou 不支持 channels 过滤，由本代理层过滤）
      var ALLOWED = ["quark", "baidu"];
      if (parsed && parsed.data && parsed.data.merged_by_type) {
        var mg = parsed.data.merged_by_type;
        var ntotal = 0;
        Object.keys(mg).forEach(function(k) {
          if (ALLOWED.indexOf(k) < 0) delete mg[k];
          else ntotal += (Array.isArray(mg[k]) ? mg[k].length : 0);
        });
        if (typeof parsed.data.total === "number") parsed.data.total = ntotal;
      }
      var h = { "Content-Type": "application/json; charset=utf-8" };
      var o = res._req ? corsOrigin(res._req) : null;
      if (o) h["Access-Control-Allow-Origin"] = o;
      res.writeHead(pr.status, h);
      res.end(JSON.stringify(parsed));
      return;
    } catch (e) {
      lastError = { error: "pansou_proxy_error", message: e.message };
      continue;
    }
  }
  json(res, 502, lastError || { error: "pansou_error", message: "request failed after retries" });
}

module.exports = { proxyPansou };
