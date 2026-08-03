const { json, readBody, fetchHttps } = require("../middleware");
const { PANSOU_BASE } = require("../../lib/storage");
const { hash, enc, dec } = require("../../lib/crypto");
const auth = require("../../lib/auth");
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");

async function login(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var adminData = await store.getAdmin();
    var t = auth.login(b.password, adminData.password);
    json(res, t ? 200 : 401, t ? { token: t } : { error: "wrong_password" });
  } catch (e) { json(res, 400, { error: e.message }); }
}

async function logout(req, res) {
  var token = (req.headers["authorization"] || "").replace("Bearer ", "");
  auth.logout(token);
  json(res, 200, { ok: true });
}

async function status(req, res) {
  var cfg = await store.getConfig();
  var cookieObj = await store.getCookiesObj();
  var hasQuark = !!cookieObj.quark;
  var hasBaidu = !!cookieObj.baidu;
  var cst = await store.cacheStats();
  var cacheTotal = cst.total || 0;
  var cookieSize = 0;
  try {
    Object.keys(cookieObj).forEach(function (k) { cookieSize += String(cookieObj[k]).length; });
  } catch (e) {}
  var pansouOk = false;
  try {
    var pansouRes = await fetchHttps(cfg.pansouBase || PANSOU_BASE, "/api/search?kw=test&_t=1");
    pansouOk = pansouRes.status === 200;
  } catch (e) { pansouOk = false; }
  var adminData = await store.getAdmin();
  json(res, 200, {
    pansou: pansouOk,
    quark: hasQuark,
    baidu: hasBaidu,
    cache: cacheTotal,
    cookieSize: cookieSize,
    adminSince: adminData.created || 0,
  });
}

async function saveCookies(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = await store.getConfig();
    var key = cfg.encKey || "x";
    var results = { quark: null, baidu: null };

    // Validate quark first
    if (b.quark) {
      try {
        var qr = await fetchHttps("drive-h.quark.cn", "/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=0&size=1&__t=" + Date.now(), {
          "Cookie": b.quark,
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch"
        });
        if (qr.status !== 200) {
          results.quark = { saved: false, error: "验证失败，服务器返回" + qr.status };
        } else {
          await store.saveCookie("quark", enc(b.quark, key));
          results.quark = { saved: true };
        }
      } catch (e) { results.quark = { saved: false, error: "验证失败" }; }
    }

    // Validate baidu
    if (b.baidu) {
      try {
        var br = await fetchHttps("pan.baidu.com", "/api/quota", { "Cookie": b.baidu });
        var bj = JSON.parse(br.body);
        if (br.status !== 200 || bj.errno !== 0) {
          results.baidu = { saved: false, error: "验证失败" };
        } else {
          await store.saveCookie("baidu", enc(b.baidu, key));
          results.baidu = { saved: true };
        }
      } catch (e) { results.baidu = { saved: false, error: "验证失败（百度）" }; }
    }

    var allOk = (!b.quark || results.quark.saved) && (!b.baidu || results.baidu.saved);
    json(res, allOk ? 200 : 200, { ok: allOk, results: results });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function testCookies(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    if (b.quark) b.quark = b.quark.trim();
    if (b.baidu) b.baidu = b.baidu.trim();
    var result = { quark: false, baidu: false, quarkDetail: "", baiduDetail: "" };
    if (b.quark) {
      try {
        var qr = await fetchHttps("drive-h.quark.cn", "/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=0&size=1&__t=" + Date.now(), {
          "Cookie": b.quark,
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch"
        });
        result.quark = qr.status === 200;
        result.quarkDetail = qr.status;
      } catch (e) { result.quarkDetail = e.message; }
    }
    if (b.baidu) {
      try {
        var br = await fetchHttps("pan.baidu.com", "/api/quota", { "Cookie": b.baidu });
        var bj = JSON.parse(br.body);
        result.baidu = br.status === 200 && bj.errno === 0;
        result.baiduDetail = bj.errno === 0 ? "ok" : "errno:" + bj.errno;
      } catch (e) { result.baiduDetail = e.message; }
    }
    json(res, 200, result);
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getCookieSummary(req, res) {
  try {
    var cfg = await store.getConfig();
    var cookieObj = await store.getCookiesObj();
    var result = { quark: null, baidu: null };
    if (cookieObj.quark) {
      try {
        var qCookie = dec(cookieObj.quark, cfg.encKey);
        var qr = await fetchHttps("drive-h.quark.cn", "/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=0&size=1&__t=" + Date.now(), {
          "Cookie": qCookie,
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch"
        });
        result.quark = { valid: qr.status === 200 };
      } catch (e) { result.quark = { valid: false }; }
    }
    if (cookieObj.baidu) {
      try {
        var bCookie = dec(cookieObj.baidu, cfg.encKey);
        var br = await fetchHttps("pan.baidu.com", "/api/quota", { "Cookie": bCookie });
        var bj = JSON.parse(br.body);
        result.baidu = { valid: br.status === 200 && bj.errno === 0 };
      } catch (e) { result.baidu = { valid: false }; }
    }
    json(res, 200, result);
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getConfig(req, res) {
  var cfg = await store.getConfig();
  json(res, 200, { pansouBase: cfg.pansouBase || PANSOU_BASE, baiduDir: cfg.baiduDir || "/", shareUrlPrefix: cfg.shareUrlPrefix || "" });
}

async function saveConfig(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = await store.getConfig();
    if (b.pansouBase) cfg.pansouBase = b.pansouBase;
    if (b.baiduDir !== undefined) cfg.baiduDir = b.baiduDir;
    if (b.shareUrlPrefix !== undefined) cfg.shareUrlPrefix = b.shareUrlPrefix;
    await store.saveConfig(cfg);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function cacheInfo(req, res) {
  var cst = await store.cacheStats();
  json(res, 200, cst);
}

async function clearCache(req, res) {
  await store.cacheClear();
  json(res, 200, { ok: true });
}

async function changePassword(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var adminData = await store.getAdmin();
    if (!auth.login(b.oldPassword, adminData.password)) {
      json(res, 403, { error: "current_password_wrong" }); return;
    }
    await store.setAdminPassword(hash(b.newPassword));
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// MySQL 接入状态（健康检查）
async function dbStatus(req, res) {
  var st = await mysql.status();
  json(res, 200, st);
}

module.exports = { login, logout, status, saveCookies, testCookies, getCookieSummary, getConfig, saveConfig, cacheInfo, clearCache, changePassword, dbStatus };
