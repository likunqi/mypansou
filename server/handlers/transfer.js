const { json, readBody } = require("../middleware");
const { PANSOU_BASE } = require("../../lib/storage");
const { dec } = require("../../lib/crypto");
const store = require("../../lib/store");
const quark = require("../../lib/quark");
const baidu = require("../../lib/baidu");

function _decCookie(cookieObj, provider, encKey) {
  if (!cookieObj || !cookieObj[provider]) return "";
  try { return dec(cookieObj[provider], encKey); } catch (e) { return ""; }
}

async function handler(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var url = b.url;
    var type = b.type || "quark";
    var srcTitle = String(b.title || "").trim().slice(0, 256); // 采集标题（前端卡片传），优先于网盘侧名称
    if (!url) { json(res, 400, { error: "url required" }); return; }

    var cfg = await store.getConfig();
    var cookieObj = await store.getCookiesObj();

    if (type === "baidu") {
      var bduss = _decCookie(cookieObj, "baidu", cfg.encKey);
      if (!bduss) { json(res, 400, { error: "baidu cookie not configured" }); return; }
      var qr = await baidu.transfer(url, bduss);
      var result = { newUrl: qr.url, saved: true, pwd: qr.pwd || "" };
      if (cfg.shareUrlPrefix) {
        var sid = (qr.url || "").match(/\x2fs\x2f([a-zA-Z0-9]+)/);
        if (sid) result.newUrl = cfg.shareUrlPrefix + sid[1];
      }
      await store.historyAdd({ originalUrl: url, newUrl: result.newUrl, pwd: result.pwd, type: "baidu", title: srcTitle || qr.fileName || "", success: true, createdAt: Date.now() });
      json(res, 200, { cached: false, result: result });
      return;
    }

    var cached = await store.cacheGet(url);
    if (cached) { json(res, 200, { cached: true, result: cached }); return; }

    var qCookie = _decCookie(cookieObj, "quark", cfg.encKey);
    if (!qCookie) { json(res, 400, { error: "quark cookie not configured" }); return; }
    var qr = await quark.transfer(url, qCookie);
    var result = { newUrl: qr.url, saved: true, pwd: qr.pwd || "" };
    if (qr.note) result.note = qr.note;
    if (cfg.shareUrlPrefix) {
      var sid = (qr.url || "").match(/\x2fs\x2f([a-zA-Z0-9]+)/);
      if (sid) result.newUrl = cfg.shareUrlPrefix + sid[1];
    }
    await store.cacheSet(url, result);
    await store.historyAdd({ originalUrl: url, newUrl: result.newUrl, pwd: result.pwd, type: "quark", title: srcTitle || qr.fileName || "", success: true, createdAt: Date.now() });
    json(res, 200, { cached: false, result: result });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getHistory(req, res) {
  var records = await store.historyList(50);
  json(res, 200, { records: records });
}

module.exports = { handler, getHistory };
