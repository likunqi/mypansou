const { json, readBody } = require("../middleware");
const { PANSOU_BASE } = require("../../lib/storage");
const { dec } = require("../../lib/crypto");
const store = require("../../lib/store");
const quark = require("../../lib/quark");
const baidu = require("../../lib/baidu");

// 多账号随机轮询：从账号列表选一个启用账号解密（分散风控）
function _decCookie(accounts, provider, encKey) {
  if (!accounts || !accounts.length) return "";
  var list = accounts.filter(function (a) { return a.provider === provider && a.enabled !== false; });
  if (!list.length) return "";
  var pick = list[Math.floor(Math.random() * list.length)];
  try { return dec(pick.encrypted, encKey); } catch (e) { return ""; }
}

async function handler(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var url = b.url;
    var type = b.type || "quark";
    var srcTitle = String(b.title || "").trim().slice(0, 256); // 采集标题（前端卡片传），优先于网盘侧名称
    if (!url) { json(res, 400, { error: "url required" }); return; }

    var cfg = await store.getConfig();
    var accounts = await store.getCookieAccounts();

    if (type === "baidu") {
      var bduss = _decCookie(accounts, "baidu", cfg.encKey);
      if (!bduss) { json(res, 400, { error: "baidu cookie not configured" }); return; }
      var qr = await baidu.transfer(url, bduss);
      var result = { newUrl: qr.url, saved: true, pwd: qr.pwd || "" };
      await store.historyAdd({ originalUrl: url, newUrl: result.newUrl, pwd: result.pwd, type: "baidu", title: srcTitle || qr.fileName || "", success: true, createdAt: Date.now() });
      json(res, 200, { cached: false, result: result });
      return;
    }

    var cached = await store.cacheGet(url);
    if (cached) { json(res, 200, { cached: true, result: cached }); return; }

    var qCookie = _decCookie(accounts, "quark", cfg.encKey);
    if (!qCookie) { json(res, 400, { error: "quark cookie not configured" }); return; }
    var qr = await quark.transfer(url, qCookie);
    var result = { newUrl: qr.url, saved: true, pwd: qr.pwd || "" };
    if (qr.note) result.note = qr.note;
    await store.cacheSet(url, result);
    await store.historyAdd({ originalUrl: url, newUrl: result.newUrl, pwd: result.pwd, type: "quark", title: srcTitle || qr.fileName || "", success: true, createdAt: Date.now() });
    json(res, 200, { cached: false, result: result });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getHistory(req, res) {
  var records = await store.historyList(50);
  json(res, 200, { records: records });
}

async function historyDelete(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var ids = (b.ids || []).map(Number).filter(function (n) { return n > 0; });
    if (!ids.length) { json(res, 400, { error: "ids required" }); return; }
    await store.historyDelete(ids);
    json(res, 200, { ok: true, deleted: ids.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function historyClear(req, res) {
  try {
    await store.historyClear();
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { handler, getHistory, historyDelete, historyClear };
