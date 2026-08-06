const { json, readBody, fetchHttps } = require("../middleware");
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
  var accounts = await store.getCookieAccounts();
  var hasQuark = accounts.some(function (a) { return a.provider === "quark" && a.enabled; });
  var hasBaidu = accounts.some(function (a) { return a.provider === "baidu" && a.enabled; });
  var cst = await store.cacheStats();
  var cacheTotal = cst.total || 0;
  var cookieSize = 0;
  accounts.forEach(function (a) { cookieSize += String(a.encrypted).length; });
  var pansouOk = false;
  try {
    var pb = store.pickPansouBase(await store.getPansouBases());
    if (pb) {
      var pansouRes = await fetchHttps(pb.host, "/api/search?kw=test&_t=1");
      pansouOk = pansouRes.status === 200;
    }
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

// 验证单条 cookie 有效性（quark 调文件列表 / baidu 调配额）
async function testCookieValue(provider, cookie) {
  if (provider === "quark") {
    var qr = await fetchHttps("drive-h.quark.cn", "/1/clouddrive/file?pr=ucpro&fr=pc&pdir_fid=0&size=1&__t=" + Date.now(), {
      "Cookie": cookie,
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch"
    });
    return { valid: qr.status === 200, detail: String(qr.status) };
  }
  var br = await fetchHttps("pan.baidu.com", "/api/quota", { "Cookie": cookie });
  var bj = JSON.parse(br.body);
  return { valid: br.status === 200 && bj.errno === 0, detail: bj.errno === 0 ? "ok" : "errno:" + bj.errno };
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

// 单条 cookie 测试（新增/编辑前预验证）
async function cookieTest(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var provider = b.provider || "quark";
    var cookie = String(b.cookie || "").trim();
    if (!cookie) { json(res, 400, { error: "cookie required" }); return; }
    var t = await testCookieValue(provider, cookie);
    json(res, 200, { ok: t.valid, detail: t.detail });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// GET /api/admin/cookies —— 账号列表（不含密文）
async function cookieList(req, res) {
  try {
    var accounts = await store.getCookieAccounts();
    json(res, 200, { accounts: accounts.map(function (a) {
      return { id: a.id, provider: a.provider, name: a.name, enabled: a.enabled, is_valid: a.is_valid, last_tested_at: a.last_tested_at };
    }) });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/cookies —— 新增账号（先验证再存）
async function cookieAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var provider = b.provider, cookie = String(b.cookie || "").trim(), name = String(b.name || "").trim();
    if (["quark", "baidu"].indexOf(provider) < 0) { json(res, 400, { error: "provider must be quark|baidu" }); return; }
    if (!cookie) { json(res, 400, { error: "cookie required" }); return; }
    var t = await testCookieValue(provider, cookie);
    if (!t.valid) { json(res, 400, { error: "cookie 验证失败: " + t.detail }); return; }
    var cfg = await store.getConfig();
    await store.cookieAdd(provider, enc(cookie, cfg.encKey || "x"), name);
    json(res, 200, { ok: true, valid: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/cookies/:id —— 更新（改名/启停/换 cookie）
async function cookieUpdate(req, res) {
  try {
    var m = req.url.match(/\/api\/admin\/cookies\/(\d+)/);
    if (!m) { json(res, 400, { error: "bad_id" }); return; }
    var b = JSON.parse(await readBody(req));
    var fields = {};
    if (b.name !== undefined) fields.name = String(b.name).trim();
    if (b.enabled !== undefined) fields.enabled = b.enabled ? 1 : 0;
    if (b.cookie !== undefined && String(b.cookie).trim()) {
      var accounts = await store.getCookieAccounts();
      var acc = accounts.filter(function (a) { return String(a.id) === m[1]; })[0];
      if (!acc) { json(res, 404, { error: "account not found" }); return; }
      var t = await testCookieValue(acc.provider, String(b.cookie).trim());
      var cfg = await store.getConfig();
      fields.encrypted_value = enc(String(b.cookie).trim(), cfg.encKey || "x");
      fields.is_valid = t.valid ? 1 : 0;
      fields.last_tested_at = new Date();
    }
    await store.cookieUpdate(m[1], fields);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/cookies/:id/delete
async function cookieDelete(req, res) {
  try {
    var m = req.url.match(/\/api\/admin\/cookies\/(\d+)\/delete/);
    if (!m) { json(res, 400, { error: "bad_id" }); return; }
    await store.cookieDelete(m[1]);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// POST /api/admin/cookies/:id/test —— 测试已保存账号（解密验证，更新 is_valid）
async function cookieTestById(req, res) {
  try {
    var m = req.url.match(/\/api\/admin\/cookies\/(\d+)\/test/);
    if (!m) { json(res, 400, { error: "bad_id" }); return; }
    var accounts = await store.getCookieAccounts();
    var acc = accounts.filter(function (a) { return String(a.id) === m[1]; })[0];
    if (!acc) { json(res, 404, { error: "account not found" }); return; }
    var cfg = await store.getConfig();
    var plain = "";
    try { plain = dec(acc.encrypted, cfg.encKey); } catch (e) {}
    if (!plain) { json(res, 400, { error: "解密失败，请重新编辑粘贴 Cookie" }); return; }
    var t = await testCookieValue(acc.provider, plain);
    await store.cookieUpdate(m[1], { is_valid: t.valid ? 1 : 0, last_tested_at: new Date() });
    json(res, 200, { ok: t.valid, valid: t.valid, detail: t.detail, provider: acc.provider, name: acc.name });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getCookieSummary(req, res) {
  try {
    var accounts = await store.getCookieAccounts();
    var cfg = await store.getConfig();
    var result = { quark: null, baidu: null, accounts: [] };
    for (var i = 0; i < accounts.length; i++) {
      var a = accounts[i];
      var plain = "";
      try { plain = dec(a.encrypted, cfg.encKey); } catch (e) {}
      var valid = false, detail = "";
      if (plain) {
        try { var t = await testCookieValue(a.provider, plain); valid = t.valid; detail = t.detail; } catch (e) {}
      }
      result.accounts.push({ id: a.id, provider: a.provider, name: a.name, valid: valid, detail: detail, enabled: a.enabled });
      if (a.provider === "quark" && !result.quark) result.quark = { valid: valid };
      if (a.provider === "baidu" && !result.baidu) result.baidu = { valid: valid };
    }
    json(res, 200, result);
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getConfig(req, res) {
  var cfg = await store.getConfig();
  json(res, 200, { pansouBases: await store.getPansouBases() });
}

// 仪表盘聚合：资源统计 + 转存统计 + 热搜词数 + 最近转存
async function dashboard(req, res) {
  try {
    var stats = await store.resourceStats();
    var tr = await store.transferStats();
    var kw = await store.keywordCount();
    var recent = await store.historyList(8);
    json(res, 200, {
      stats: stats || { total: 0, byType: {}, valid: 0 },
      transfers: tr || { total: 0, today: 0 },
      keywords: kw || 0,
      recent: recent || [],
    });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 站点配置（TDK/favicon/自定义代码）
async function getSiteConfig(req, res) {
  try { json(res, 200, await store.getSiteConfig()); }
  catch (e) { json(res, 500, { error: e.message }); }
}
async function saveSiteConfig(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    await store.saveSiteConfig(b);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function saveConfig(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = await store.getConfig();
    if (Array.isArray(b.pansouBases)) {
      // site_config 存字符串，数组 JSON 化存储（getPansouBases 读回时自动解析）
      cfg.pansouBase = JSON.stringify(b.pansouBases
        .map(function (h) { return { name: String(h.name || "").trim(), host: String(h.host || "").trim(), enabled: !!h.enabled, weight: parseInt(h.weight, 10) || 1 }; })
        .filter(function (h) { return h.host; }));
    } else if (typeof b.pansouBase === "string" && b.pansouBase.trim()) {
      cfg.pansouBase = b.pansouBase.trim();
    }
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

// ---------- MySQL 连接配置（data/db.config.json，密码不回显） ----------
async function getDbConfig(req, res) {
  try {
    var st = await mysql.status();
    json(res, 200, { host: st.host, port: st.port, user: st.user, database: st.database, tables: st.tables, ready: st.ready, error: st.error || "", hasPassword: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function saveDbConfig(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var fp = require("path").join(__dirname, "..", "..", "data", "db.config.json");
    var cur = {};
    try { cur = JSON.parse(require("fs").readFileSync(fp, "utf8")); } catch (e) {}
    var next = {
      host: String(b.host || cur.host || "").trim(),
      port: parseInt(b.port || cur.port || "3306", 10),
      user: String(b.user || cur.user || "").trim(),
      password: (b.password !== undefined && String(b.password) !== "") ? String(b.password) : (cur.password || ""),
      database: String(b.database || cur.database || "").trim(),
    };
    if (!next.host || !next.user || !next.database) { json(res, 400, { error: "host/user/database 必填" }); return; }
    require("fs").writeFileSync(fp, JSON.stringify(next, null, 2));
    var st = await mysql.reconnect();
    if (!st.ready) { json(res, 500, { error: "连接失败：" + (st.error || "") }); return; }
    json(res, 200, { ok: true, status: st });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 项目配置导出 / 导入（site_config + 分类 + 热搜词；cookies 敏感不导出） ----------
async function configExport(req, res) {
  try {
    var [cfg, cats, kws] = await Promise.all([
      mysql.cfgGetAll().catch(function () { return {}; }),
      store.categoryList(500),
      store.keywordList(500, false),
    ]);
    var data = { app: "pansou", exported_at: new Date().toISOString(), site_config: cfg || {}, categories: cats || [], search_keywords: kws || [] };
    var body = JSON.stringify(data, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pansou-config-' + new Date().toISOString().slice(0, 10) + '.json"',
    });
    res.end(body);
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function configImport(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var log = [];
    // 1. site_config（跳过加密密钥与迁移标记）
    if (b.site_config && typeof b.site_config === "object") {
      var clean = {};
      Object.keys(b.site_config).forEach(function (k) {
        if (k === "encKey" || k === "migration_v1") return;
        var v = b.site_config[k];
        clean[k] = (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v);
      });
      await mysql.cfgSetAll(clean);
      log.push("site_config " + Object.keys(clean).length + " 项");
    }
    // 2. 分类（存在则跳过）
    if (Array.isArray(b.categories)) {
      var cadd = 0;
      for (var i = 0; i < b.categories.length; i++) {
        var c = b.categories[i];
        try { await store.categoryAdd({ name: c.name, sort_order: c.sort_order, status: c.status }); cadd++; } catch (e) {}
      }
      log.push("categories +" + cadd);
    }
    // 3. 热搜词（upsert，热度以导入值为准）
    if (Array.isArray(b.search_keywords)) {
      var kadd = 0;
      for (var j = 0; j < b.search_keywords.length; j++) {
        var k = b.search_keywords[j];
        try { await store.keywordEnsure(k.keyword, { is_hot: k.is_hot, sort_order: k.sort_order, status: k.status === undefined ? 1 : k.status, source: k.source, search_count: k.search_count }); kadd++; } catch (e) {}
      }
      log.push("search_keywords " + kadd + " 词");
    }
    json(res, 200, { ok: true, log: log.join("；") });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ---------- 资源列表导出 CSV（按当前筛选条件，BOM 防 Excel 乱码） ----------
async function resourceExport(req, res) {
  try {
    var u = new URL(req.url, "http://" + req.headers.host);
    var opt = {
      kw: u.searchParams.get("kw") || "",
      category: u.searchParams.get("category") || "",
      diskType: u.searchParams.get("disk_type") || "",
      source: u.searchParams.get("source") || "",
      status: u.searchParams.get("status") || "",
      created_from: u.searchParams.get("created_from") || "",
      created_to: u.searchParams.get("created_to") || "",
    };
    var rows = await store.resourceExportAll(opt);
    var esc = function (s) { s = String(s == null ? "" : s); return '"' + s.replace(/"/g, '""') + '"'; };
    var fmtDate = function (d) { if (!d) return ""; try { var t = new Date(d); return isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10); } catch (e) { return ""; } };
    var head = "标题,链接,提取码,网盘,分类,标签,来源,入库时间";
    var lines = (rows || []).map(function (x) {
      return [x.title, x.url, x.password, x.disk_type, x.category, x.tags, x.source, fmtDate(x.created_at)].map(esc).join(",");
    });
    var csv = "\uFEFF" + head + "\n" + lines.join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="resources-' + new Date().toISOString().slice(0, 10) + '.csv"',
    });
    res.end(csv);
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { login, logout, status, saveCookies, testCookies, cookieTest, cookieList, cookieAdd, cookieUpdate, cookieDelete, cookieTestById, getCookieSummary, getConfig, saveConfig, cacheInfo, clearCache, changePassword, dbStatus, dashboard, getSiteConfig, saveSiteConfig, getDbConfig, saveDbConfig, configExport, configImport, resourceExport };
