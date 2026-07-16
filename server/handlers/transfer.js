const path = require("path");
const { json, readBody } = require("../middleware");
const { rd, wr, PATHS, PANSOU_BASE } = require("../../lib/storage");
const { dec } = require("../../lib/crypto");
const quark = require("../../lib/quark");
const baidu = require("../../lib/baidu");

async function handler(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var url = b.url;
    var type = b.type || "quark";
    if (!url) { json(res, 400, { error: "url required" }); return; }

    if (type === "baidu") {
      var cfg = rd(PATHS.CFG, {});
      var encCookies = "";
      try { encCookies = require("fs").readFileSync(PATHS.COOKIES, "utf8"); } catch(e) {}
      var cookieObj = {};
      try { cookieObj = JSON.parse(encCookies); } catch(e) {}
      var bduss = "";
      if (cookieObj.baidu) { try { bduss = dec(cookieObj.baidu, cfg.encKey); } catch(e) {} }
      if (!bduss) { json(res, 400, { error: "baidu cookie not configured" }); return; }
      var qr = await baidu.transfer(url, bduss);
      var result = { newUrl: qr.url, saved: true, pwd: qr.pwd || "" };
      if (cfg.shareUrlPrefix) {
        var sid = (qr.url || "").match(/\x2fs\x2f([a-zA-Z0-9]+)/);
        if (sid) result.newUrl = cfg.shareUrlPrefix + sid[1];
      }
      _writeHistory(url, result, qr.fileName || "", "baidu");
      json(res, 200, { cached: false, result: result });
      return;
    }

    var cacheData = rd(PATHS.CACHE, { links: {} });
    var cached = cacheData.links[url];
    if (cached) { json(res, 200, { cached: true, result: cached }); return; }
    var cfg = rd(PATHS.CFG, {});
    var encCookies = "";
    try { encCookies = require("fs").readFileSync(PATHS.COOKIES, "utf8"); } catch(e) {}
    var cookieObj = {};
    try { cookieObj = JSON.parse(encCookies); } catch(e) {}
    var qCookie = "";
    if (cookieObj.quark) { try { qCookie = dec(cookieObj.quark, cfg.encKey); } catch(e) {} }
    if (!qCookie) { json(res, 400, { error: "quark cookie not configured" }); return; }
    var qr = await quark.transfer(url, qCookie);
    var result = { newUrl: qr.url, saved: true, pwd: qr.pwd || "" };
    if (qr.note) result.note = qr.note;
    if (cfg.shareUrlPrefix) {
      var sid = (qr.url || "").match(/\x2fs\x2f([a-zA-Z0-9]+)/);
      if (sid) result.newUrl = cfg.shareUrlPrefix + sid[1];
    }
    cacheData.links[url] = result;
    cacheData.stats = cacheData.stats || { total: 0, quark: 0, baidu: 0 };
    cacheData.stats.total = Object.keys(cacheData.links).length;
    wr(PATHS.CACHE, cacheData);
    _writeHistory(url, result, qr.fileName || "", "quark");
    json(res, 200, { cached: false, result: result });
  } catch(e) { json(res, 500, { error: e.message }); }
}

function _writeHistory(url, result, title, type) {
  try {
    var hPath = path.join(PATHS.DATA_DIR, "transfer_history.json");
    var hist = { records: [] };
    try { hist = JSON.parse(require("fs").readFileSync(hPath, "utf8")); } catch(e) {}
    hist.records.unshift({ originalUrl: url, newUrl: result.newUrl, pwd: result.pwd, type: type, success: true, createdAt: Date.now(), title: title });
    if (hist.records.length > 100) hist.records = hist.records.slice(0, 100);
    require("fs").writeFileSync(hPath, JSON.stringify(hist, null, 2), "utf8");
  } catch(e) { console.error("history:", e.message); }
}

async function getHistory(req, res) {
  var hPath = path.join(PATHS.DATA_DIR, "transfer_history.json");
  var hist = { records: [] };
  try { hist = JSON.parse(require("fs").readFileSync(hPath, "utf8")); } catch(e) {}
  json(res, 200, { records: hist.records.slice(0, 50) });
}

module.exports = { handler, getHistory };