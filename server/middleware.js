const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif":  "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

// 取客户端真实 IP：优先 X-Forwarded-For（Cloudflare Tunnel 场景），回退 socket 地址
function getClientIp(req) {
  var xff = req.headers["x-forwarded-for"];
  if (xff) {
    var first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  return (req.socket && req.socket.remoteAddress) || "?";
}

// CORS 白名单收紧：仅同源请求回显 Origin（上线加固，原为 * 全开放）。
// 同源 fetch 无需 CORS 头；跨域（其他网站脚本）不返回 CORS 头会被浏览器拦截。
function corsOrigin(req) {
  var origin = req.headers["origin"];
  if (!origin) return null;
  try {
    var o = new URL(origin);
    var h = String(req.headers["host"] || "").toLowerCase();
    if (o.host === h) return origin;
  } catch (e) {}
  return null;
}

function json(res, status, data) {
  var h = { "Content-Type": "application/json; charset=utf-8" };
  var o = res._req ? corsOrigin(res._req) : null;
  if (o) h["Access-Control-Allow-Origin"] = o;
  res.writeHead(status, h);
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(function(resolve, reject) {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() { resolve(body); });
    req.on("error", reject);
  });
}

function fetchHttps(hostname, pathname, headers, postBody) {
  return new Promise(function(resolve, reject) {
    var raw = String(hostname || "").trim();
    var protocol = "https:";
    var explicit = false;
    if (/^https:\/\//i.test(raw)) { explicit = true; raw = raw.replace(/^https?:\/\//i, ""); }
    else if (/^http:\/\//i.test(raw)) { protocol = "http:"; explicit = true; raw = raw.replace(/^https?:\/\//i, ""); }
    var port = protocol === "https:" ? 443 : 80;
    var hostOnly = raw;
    var m = raw.match(/^(.*):(\d+)$/);
    // 显式带协议前缀时尊重协议；无前缀时按旧推断（非 443 端口视为 http）
    if (m) { hostOnly = m[1]; port = parseInt(m[2], 10); if (!explicit && protocol === "https:" && port !== 443) protocol = "http:"; }
    var mod = protocol === "http:" ? http : https;
    var opts = { hostname: hostOnly, port: port, path: pathname, method: postBody ? "POST" : "GET", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } };
    if (protocol === "https:") opts.rejectUnauthorized = false; // 部分自建源证书自签，跳过校验（curl -k 等价）
    if (headers) Object.assign(opts.headers, headers);
    var req = mod.request(opts, function(r) {
      var d = "";
      r.on("data", function(c) { d += c; });
      r.on("end", function() { resolve({ status: r.statusCode, headers: r.headers, body: d }); });
    });
    req.on("error", reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 站点配置注入：首页 HTML 动态渲染 title / description / keywords / favicon / 自定义代码
function injectSiteMeta(html, site) {
  var s = site || {};
  var title = s.site_name ? (s.site_name + " - 网盘资源搜索引擎") : "云盘搜- 网盘资源搜索引擎";
  var desc = s.site_description || "网盘资源搜索引擎，聚合夸克/百度/阿里云盘资源搜索与转存";
  var kws = s.site_keywords || "云盘搜索,夸克网盘,百度网盘";
  var inject = '<meta name="description" content="' + esc(desc) + '">' +
    '<meta name="keywords" content="' + esc(kws) + '">';
  if (s.site_favicon) inject += '<link rel="icon" href="' + esc(s.site_favicon) + '">';
  if (s.site_custom_head) inject += s.site_custom_head;
  html = html.replace(/<title>[^<]*<\/title>/, "<title>" + esc(title) + "</title>");
  html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">' + inject);
  return html;
}

function serveStatic(res, urlPath) {
  var safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  // Windows 下 path.normalize("/") 返回 "\"，统一斜杠便于判断根路径
  var norm = safe.replace(/\\/g, "/");
  var fp = path.join(__dirname, "..", "public", norm === "/" ? "index.html" : norm);
  var ext = path.extname(fp).toLowerCase();
  var ct = MIME[ext] || "application/octet-stream";
  // HTML 经常更新，禁止启发式缓存，保证前端每次拿到最新版
  var cacheCtl = ext === ".html" ? "no-cache" : "public, max-age=3600";
  fs.readFile(fp, function(err, data) {
    if (err) {
      // SEO 优化：不存在时返回真正的 404（原实现回退首页，搜索引擎会误收录）
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>404 - 页面不存在</title></head><body style="font-family:sans-serif;background:#0F172A;color:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:48px;margin:0">404</h1><p style="color:#94A3B8">页面不存在或已被移除</p><a href="/" style="color:#22C55E;text-decoration:none;margin-top:16px;display:inline-block">返回首页 →</a></div></body></html>');
      return;
    }
    // 首页/根路径做站点配置注入（TDK/favicon/自定义代码）
    if (ext === ".html" && (norm === "/" || norm === "index.html")) {
      const store = require("../lib/store");
      store.getSiteConfig().then(function(site) {
        var out = injectSiteMeta(data.toString("utf8"), site);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(out);
      }).catch(function() {
        res.writeHead(200, { "Content-Type": ct, "Cache-Control": cacheCtl });
        res.end(data);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": ct, "Cache-Control": cacheCtl });
    res.end(data);
  });
}

function logger(req, res) {
  var start = Date.now();
  var sc;
  var origWH = res.writeHead;
  var origEnd = res.end;
  res.writeHead = function() { sc = arguments[0]; return origWH.apply(this, arguments); };
  res.end = function(body) {
    var dur = Date.now() - start;
    var u = (req.headers.host ? new URL(req.url, "http://" + req.headers.host).pathname : req.url);
    var msg = req.method + " " + u + " " + sc + " " + dur + "ms";
    if (sc >= 400 && body) {
      var s = typeof body === "string" ? body.substring(0, 200) : "";
      msg += " " + s;
    }
    console.log(msg);
    return origEnd.apply(this, arguments);
  };
}

function cors(req, res) {
  var h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" };
  var o = corsOrigin(req);
  if (o) h["Access-Control-Allow-Origin"] = o;
  res.writeHead(204, h);
  res.end();
}

module.exports = { MIME, json, readBody, fetchHttps, serveStatic, cors, logger, getClientIp, corsOrigin, injectSiteMeta };
