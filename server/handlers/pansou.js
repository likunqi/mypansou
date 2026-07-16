const { fetchHttps, json } = require("../middleware");
const { rd, PATHS, PANSOU_BASE } = require("../../lib/storage");

async function proxyPansou(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var cfg = rd(PATHS.CFG, {});
  var base = cfg.pansouBase || PANSOU_BASE;
  var targetPath = u.pathname.replace(/^\/api\/pansou/, "/api") + u.search;
  try {
    var pr = await fetchHttps(base, targetPath);
    try { JSON.parse(pr.body); } catch (pe) {
      json(res, 502, { error: "pansou_api_error", message: "pansou returned non-JSON response" });
      return;
    }
    res.writeHead(pr.status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(pr.body);
  } catch (e) {
    json(res, 502, { error: "pansou_proxy_error", message: e.message });
  }
}

module.exports = { proxyPansou };
