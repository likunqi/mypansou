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

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
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
    var opts = { hostname: hostname, path: pathname, method: postBody ? "POST" : "GET", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } };
    if (headers) Object.assign(opts.headers, headers);
    var req = https.request(opts, function(r) {
      var d = "";
      r.on("data", function(c) { d += c; });
      r.on("end", function() { resolve({ status: r.statusCode, headers: r.headers, body: d }); });
    });
    req.on("error", reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

function serveStatic(res, urlPath) {
  var safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  var fp = path.join(__dirname, "..", "public", safe === "/" ? "index.html" : safe);
  var ext = path.extname(fp).toLowerCase();
  var ct = MIME[ext] || "application/octet-stream";
  fs.readFile(fp, function(err, data) {
    if (err) {
      fs.readFile(path.join(__dirname, "..", "public", "index.html"), function(err2, data2) {
        if (err2) return json(res, 404, { error: "Not Found" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data2);
      });
    } else {
      res.writeHead(200, { "Content-Type": ct });
      res.end(data);
    }
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
  res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" });
  res.end();
}

module.exports = { MIME, json, readBody, fetchHttps, serveStatic, cors, logger };
