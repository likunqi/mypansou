const { fetchHttps, json, readBody } = require("../middleware");
const store = require("../../lib/store");

var http = require("http");
var https = require("https");

// 本地时间 SQL 格式（与 lib/mysql.js 的 toSqlDt 约定一致）
function nowSql() {
  var d = new Date();
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

// 失效关键词（只保留高置信度中文短语；不匹配 /404/ 等易误伤正常页面的宽泛模式）
var INVALID_MARKERS = [
  /已失效/, /已删除/, /不存在/, /已取消/, /链接错误/, /来晚了/, /分享已被删除/, /分享已过期/, /文件已删除/, /链接已过期/, /内容不存在/,
  /分享链接已被取消/, /啊哦，你来晚了/, /分享的文件已经被取消/,
];

// 夸克分享链接用官方 token 接口验证（guest 可用，status 200 = 有效，404/其他 = 失效）
function checkQuarkShare(url, passcode) {
  var m = String(url || "").match(/pan\.quark\.cn\/s\/([0-9a-zA-Z]+)/);
  if (!m) return null;
  return new Promise(function (resolve) {
    var body = JSON.stringify({ pwd_id: m[1], passcode: passcode || "" });
    fetchHttps(
      "https://pan.quark.cn",
      "/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc",
      { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      body
    ).then(function (r) {
      var j;
      try { j = JSON.parse(r.body); } catch (e) { resolve({ valid: false, error: "夸克接口非 JSON", uncertain: true }); return; }
      if (j.status === 200) resolve({ valid: true, status: 200 });
      var msg = j.message || "";
      // 需要提取码 ≠ 失效（链接仍存在）
      if (/提取码|密码|passcode|pass_word|口令/i.test(msg)) resolve({ valid: true, status: j.status || r.status, needPasscode: true });
      else resolve({ valid: false, status: j.status || r.status, error: msg || ("夸克 code " + (j.status || r.status)) });
    }).catch(function (e) {
      resolve({ valid: false, error: e.message, uncertain: true }); // 网络异常 → 不确定
    });
  });
}

function checkLinkAvail(url, maxRedirects, passcode) {
  if (maxRedirects === undefined) maxRedirects = 5;
  // 夸克分享链接走官方 API（最准）；其他网盘走 HTTP + 关键词
  var qk = checkQuarkShare(url, passcode);
  if (qk) return qk;
  function checkUrl(u, redirects) {
    return new Promise(function(resolve) {
      var proto = u.startsWith("https") ? https : http;
      var req = proto.get(u, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 8000,
      }, function(r) {
        // 跟随重定向（重定向页不读内容，直接递归）
        if ((r.statusCode === 301 || r.statusCode === 302 || r.statusCode === 303 || r.statusCode === 307 || r.statusCode === 308) && r.headers.location && redirects > 0) {
          r.resume();
          try {
            var loc = new URL(r.headers.location, u).href;
            resolve(checkUrl(loc, redirects - 1));
          } catch (e) { resolve({ valid: false, status: r.statusCode, error: "invalid_redirect" }); }
          return;
        }
        // 读页面内容（限制 100KB）判断失效关键词（SSR 网盘如百度有效；SPA 如夸克已走 API）
        var chunks = [];
        var total = 0;
        r.on("data", function(c) {
          total += c.length;
          if (total <= 100000) chunks.push(c);
          else { r.destroy(); }
        });
        r.on("end", function() {
          var statusOk = r.statusCode < 400 || r.statusCode === 403 || r.statusCode === 401;
          if (!statusOk) { resolve({ valid: false, status: r.statusCode }); return; }
          var body = Buffer.concat(chunks).toString("utf8");
          var hit = null;
          for (var i = 0; i < INVALID_MARKERS.length; i++) {
            if (INVALID_MARKERS[i].test(body)) { hit = INVALID_MARKERS[i].toString(); break; }
          }
          if (hit) resolve({ valid: false, status: r.statusCode, error: "页面提示失效" });
          else resolve({ valid: true, status: r.statusCode });
        });
        r.on("error", function() { resolve({ valid: true, status: r.statusCode, error: "read_error" }); });
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
      var hb = store.pickPansouBase(await store.getPansouBases());
      if (hb) {
        var pr = await fetchHttps(hb.host, "/api/check/links", { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(pb) }, pb);
        var pj = JSON.parse(pr.body);
        if (pj.results) { json(res, 200, { code: 0, message: "success", results: pj.results }); return; }
      }
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
          var cr = await checkLinkAvail(rec.url, 5, rec.password);
          if (cr.uncertain) return { id: id, state: "uncertain", title: rec.title }; // 网络异常不可信，不写库
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
