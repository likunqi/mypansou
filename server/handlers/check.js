const { fetchHttps, json, readBody } = require("../middleware");
const { PANSOU_BASE } = require("../../lib/storage");
const store = require("../../lib/store");

var http = require("http");
var https = require("https");

// 本地时间 SQL 格式（与 lib/mysql.js 的 toSqlDt 约定一致）
function nowSql() {
  var d = new Date();
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

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
      var cfg = await store.getConfig();
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

// 本地资源检测：只检测「未检测过」的资源（last_checked_at 为空），结果写回 resources 表持久化
// 已检测过的直接返回库中状态，不重测（避免每次打开都全量检测）
async function localCheck(req, res) {
  try {
    var body = await readBody(req);
    var parsed = JSON.parse(body);
    var ids = (parsed.ids || []).slice(0, 100);
    if (!ids.length) return json(res, 200, { results: [] });

    var results = [];
    var CONC = 4;
    for (var i = 0; i < ids.length; i += CONC) {
      var batch = ids.slice(i, i + CONC);
      var batchRes = await Promise.all(batch.map(async function (id) {
        try {
          var rec = await store.resourceGet(id);
          if (!rec) return { id: id, state: "missing" };
          // 已检测过：返回缓存状态，不重测
          if (rec.last_checked_at) {
            return { id: id, state: rec.link_valid ? "valid" : "invalid", cached: true, title: rec.title };
          }
          var cr = await checkLinkAvail(rec.url);
          var state = cr.valid ? "valid" : "invalid";
          await store.resourceUpdate(id, {
            link_valid: cr.valid ? 1 : 0,
            check_message: cr.valid ? ("HTTP " + (cr.status || "ok")) : (cr.error || ("HTTP " + (cr.status || "?"))),
            last_checked_at: nowSql(),
          });
          return { id: id, state: state, title: rec.title };
        } catch (e) {
          return { id: id, state: "uncertain", title: "" };
        }
      }));
      results = results.concat(batchRes);
    }
    json(res, 200, { results: results });
  } catch (e) {
    json(res, 400, { code: 400, message: "invalid_request", error: e.message });
  }
}

module.exports = { handler, localCheck, checkLinkAvail };
