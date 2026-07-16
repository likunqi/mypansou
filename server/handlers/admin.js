const { json, readBody, fetchHttps } = require("../middleware");
const { rd, wr, PATHS, PANSOU_BASE } = require("../../lib/storage");
const { hash, enc, dec } = require("../../lib/crypto");
const auth = require("../../lib/auth");

async function login(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var adminData = rd(PATHS.ADMIN, { password: "" });
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
  var cfg = rd(PATHS.CFG, {});
  var cookieFile = "";
  try { cookieFile = require("fs").readFileSync(PATHS.COOKIES, "utf8"); } catch (e) {}
  var hasQuark = cookieFile.includes("quark:");
  var hasBaidu = cookieFile.includes("baidu:");
  var cacheData = rd(PATHS.CACHE, { links: {}, stats: { total: 0 } });
  var cacheTotal = cacheData.stats ? cacheData.stats.total : Object.keys(cacheData.links).length;
  var cookieSize = 0;
  try { cookieSize = require("fs").statSync(PATHS.COOKIES).size; } catch (e) {}
  try {
    var pansouRes = await fetchHttps(cfg.pansouBase || PANSOU_BASE, "/api/search?kw=test&_t=1");
    var pansouOk = pansouRes.status === 200;
  } catch (e) { pansouOk = false; }
  json(res, 200, {
    pansou: pansouOk,
    quark: hasQuark,
    baidu: hasBaidu,
    cache: cacheTotal,
    cookieSize: cookieSize,
    adminSince: rd(PATHS.ADMIN, {}).created || 0,
  });
}

async function saveCookies(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = rd(PATHS.CFG, {});
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
          var cookiePairs = {};
          cookiePairs.quark = enc(b.quark, key);
          var existing = "";
          try { existing = require("fs").readFileSync(PATHS.COOKIES, "utf8"); } catch (e) {}
          var existingObj = {};
          try { existingObj = JSON.parse(existing); } catch (e) {}
          Object.assign(existingObj, cookiePairs);
          wr(PATHS.COOKIES, existingObj);
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
          var cookiePairs = {};
          cookiePairs.baidu = enc(b.baidu, key);
          var existing = "";
          try { existing = require("fs").readFileSync(PATHS.COOKIES, "utf8"); } catch (e) {}
          var existingObj = {};
          try { existingObj = JSON.parse(existing); } catch (e) {}
          Object.assign(existingObj, cookiePairs);
          wr(PATHS.COOKIES, existingObj);
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
    var cfg = rd(PATHS.CFG, {});
    var cookieFile = "";
    try { cookieFile = require("fs").readFileSync(PATHS.COOKIES, "utf8"); } catch (e) {}
    var cookieObj = {};
    try { cookieObj = JSON.parse(cookieFile); } catch (e) {}
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
  var cfg = rd(PATHS.CFG, {});
  json(res, 200, { pansouBase: cfg.pansouBase || PANSOU_BASE, baiduDir: cfg.baiduDir || "/", shareUrlPrefix: cfg.shareUrlPrefix || "" });
}

async function saveConfig(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = rd(PATHS.CFG, {});
    if (b.pansouBase) cfg.pansouBase = b.pansouBase;
    if (b.baiduDir !== undefined) cfg.baiduDir = b.baiduDir;
    if (b.shareUrlPrefix !== undefined) cfg.shareUrlPrefix = b.shareUrlPrefix;
    wr(PATHS.CFG, cfg);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function cacheInfo(req, res) {
  var cacheData = rd(PATHS.CACHE, { links: {}, stats: { total: 0, quark: 0, baidu: 0 } });
  json(res, 200, cacheData.stats);
}

async function clearCache(req, res) {
  wr(PATHS.CACHE, { links: {}, stats: { total: 0, quark: 0, baidu: 0 } });
  json(res, 200, { ok: true });
}

async function changePassword(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var adminData = rd(PATHS.ADMIN, { password: "" });
    if (!auth.login(b.oldPassword, adminData.password)) {
      json(res, 403, { error: "current_password_wrong" }); return;
    }
    wr(PATHS.ADMIN, { password: hash(b.newPassword), created: Date.now() });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { login, logout, status, saveCookies, testCookies, getCookieSummary, getConfig, saveConfig, cacheInfo, clearCache, changePassword };
