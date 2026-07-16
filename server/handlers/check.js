const { fetchHttps, json, readBody } = require("../middleware");
const { rd, PATHS, PANSOU_BASE } = require("../../lib/storage");

var http = require("http");
var https = require("https");

function checkLinkAvail(url, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 5;
  function checkUrl(u, redirects) {
    return new Promise(function(resolve) {
      var proto = u.startsWith("https") ? https : http;
      var req = proto.get(u, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 8000,
      }, function(r) {
        if ((r.statusCode === 301 || r.statusCode === 302 || r.statusCode === 303 || r.statusCode === 307 || r.statusCode === 308) && r.headers.location && redirects > 0) {
          try {
            var loc = new URL(r.headers.location, u).href;
            resolve(checkUrl(loc, redirects - 1));
          } catch (e) { resolve({ valid: false, status: r.statusCode, error: "invalid_redirect" }); }
        } else {
          resolve({ valid: r.statusCode < 400 || r.statusCode === 403 || r.statusCode === 401, status: r.statusCode });
        }
        r.resume();
      });
      req.on("error", function(e) { resolve({ valid: false, error: e.message }); });
      req.on("timeout", function() { req.destroy(); resolve({ valid: false, error: "timeout" }); });
    });
  }
  return checkUrl(url, maxRedirects);
}

async function handler(req, res) {
  try {
    var body = await readBody(req);
    var parsed = JSON.parse(body);
    var items = parsed.items || [];
    var pansouItems = items.map(function(it) { return { disk_type: it.disk_type || it.type || "", url: it.url }; });
    var pb = JSON.stringify({ items: pansouItems });
    try {
      var cfg = rd(PATHS.CFG, {});
      var base = cfg.pansouBase || PANSOU_BASE;
      var pr = await fetchHttps(base, "/api/check/links", { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(pb) }, pb);
      var pj = JSON.parse(pr.body);
      if (pj.results) { json(res, 200, { code: 0, message: "success", results: pj.results }); return; }
    } catch (pe) { console.error("pansou check failed:", pe.message); }
    var fb = await Promise.all(items.map(function(it) {
      return new Promise(function(r2) {
        checkLinkAvail(it.url).then(function(cr) {
          r2({ disk_type: it.disk_type || it.type || "", url: it.url, state: cr.valid ? "valid" : "invalid", checked_at: Date.now() });
        }).catch(function() {
          r2({ disk_type: it.disk_type || it.type || "", url: it.url, state: "uncertain", checked_at: Date.now() });
        });
      });
    }));
    json(res, 200, { code: 0, message: "success", results: fb });
  } catch (e) {
    json(res, 400, { code: 400, message: "invalid_request", error: e.message });
  }
}

module.exports = { handler, checkLinkAvail };
