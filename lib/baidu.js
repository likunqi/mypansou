var https = require("https");

var APP_ID = "250528";
var BAIDU_HOST = "pan.baidu.com";

function api(method, path, cookie, body, referer) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: BAIDU_HOST,
      path: path,
      method: method,
      headers: {
        
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest"
      }
    };
    if (cookie) opts.headers["Cookie"] = cookie;
    if (body) opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (referer) opts.headers["Referer"] = referer;
    var req = https.request(opts, function(r) {
      var d = "";
      r.on("data", function(c) { d += c; });
      r.on("end", function() {
        try { resolve({ status: r.statusCode, data: JSON.parse(d), headers: r.headers }); }
        catch (e) { reject(new Error("parse failed (status=" + r.statusCode + "): " + d.substring(0, 300))); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function rawGet(path, cookie) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: BAIDU_HOST,
      path: path,
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" }
    };
    if (cookie) opts.headers["Cookie"] = cookie;
    var req = https.request(opts, function(r) {
      var d = "";
      r.on("data", function(c) { d += c; });
      r.on("end", function() { resolve({ status: r.statusCode, body: d, headers: r.headers }); });
    });
    req.on("error", reject);
    req.end();
  });
}

function parseUrl(url) {
  var m = url.match(/pan\.baidu\.com\/s\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  var surl = m[1];
  if (surl.charAt(0) === "1") surl = surl.substring(1);
  return surl;
}

function extractYunData(html) {
  var start = html.indexOf("window.yunData");
  if (start < 0) return null;
  var eq = html.indexOf("=", start);
  if (eq < 0) return null;
  var brace = html.indexOf("{", eq);
  if (brace < 0) return null;
  var depth = 1, i = brace + 1;
  while (depth > 0 && i < html.length) {
    if (html[i] === "{") depth++;
    if (html[i] === "}") depth--;
    i++;
  }
  var raw = html.substring(brace, i).replace(/'/g, "\"").replace(/,(\s*[}\]])/g, "$1").replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function collectCookies(respHeaders, cookieJar) {
  if (respHeaders && respHeaders["set-cookie"]) {
    respHeaders["set-cookie"].forEach(function(c) {
      var m = c.match(/^([^=]+=[^;]+)/);
      if (m) {
        var name = m[1].split("=")[0];
        // Update or add cookie
        var found = false;
        for (var i = 0; i < cookieJar.length; i++) {
          if (cookieJar[i].startsWith(name + "=")) {
            cookieJar[i] = m[1];
            found = true;
            break;
          }
        }
        if (!found) cookieJar.push(m[1]);
      }
    });
  }
}

async function getShareDetail(surl, bduss, passcode) {
  var jar = [];
  var refUrl = "https://pan.baidu.com/s/1" + surl;
  var initPath = "/share/init?surl=" + encodeURIComponent(surl) + "&web=1";

  // Step 1: GET share page for yunData + cookies
  var r0 = await rawGet(initPath, "");
  collectCookies(r0.headers, jar);
  var yun = extractYunData(r0.body);
  if (!yun) throw new Error("cannot parse share page (status="+r0.status+"): "+(r0.body||"").substring(0,200));

  // Step 2: If password protected, verify
  if (passcode) {
    var verifyPath = "/share/verify?web=1&surl=" + encodeURIComponent(surl);
    var verifyBody = "pwd=" + encodeURIComponent(passcode) + "&vcode=&vcode_str=";
    var r1 = await api("POST", verifyPath, jar.join("; "), verifyBody, refUrl);
    if (r1.data.errno !== 0) throw new Error("password verify failed: errno=" + r1.data.errno);
    collectCookies(r1.headers, jar);
  }

  return {
    shareid: String(yun.shareid || ""),
    uk: String(yun.share_uk || yun.uk || ""),
    cookies: jar.join("; ")
  };
}

async function ensureDir(bduss) {
  try {
    var r = await api("GET", "/api/list?dir=" + encodeURIComponent("/pansou") + "&page=1&num=10&web=1&app_id=" + APP_ID, bduss);
    if (r.data && r.data.errno === 0) return "/pansou";
  } catch (e) {}
  var r2 = await api("POST", "/api/create?a=commit&web=1", bduss,
    "path=" + encodeURIComponent("/pansou") + "&isdir=1&block_list=[]");
  if (r2.data && r2.data.errno === 0) return "/pansou";
  throw new Error("create dir failed: errno=" + (r2.data ? r2.data.errno : "?"));
}

async function transferFiles(shareid, uk, fsids, targetPath, bduss) {
  var body = "shareid=" + shareid + "&from=" + uk +
    "&fsidlist=" + encodeURIComponent(JSON.stringify(fsids)) +
    "&path=" + encodeURIComponent(targetPath);
  var r = await api("POST", "/share/transfer?web=1&app_id=" + APP_ID, bduss, body);
  if (r.data.errno !== 0) throw new Error("transfer failed: errno=" + r.data.errno + " " + (r.data.show_msg || ""));
  return r.data;
}

async function listDir(dirPath, bduss) {
  var r = await api("GET", "/api/list?dir=" + encodeURIComponent(dirPath) + "&page=1&num=100&order=time&desc=1&web=1&app_id=" + APP_ID, bduss);
  if (r.data.errno !== 0) throw new Error("listDir failed: errno=" + r.data.errno);
  return r.data.data ? r.data.data.list || [] : [];
}

async function createShare(fs_id, bduss) {
  var body = "schannel=4&channel_list=[]&fid_list=" +
    encodeURIComponent(JSON.stringify([String(fs_id)])) +
    "&shareanony=0&pwd=1234&period=0";
  var r = await api("POST", "/share/set?web=1", bduss, body);
  if (r.data.errno !== 0) {
    if (r.data.errno === 112) throw new Error("share limit reached, cancel old shares first");
    if (r.data.errno === 2) throw new Error("create share failed: phone not bound or param error");
    throw new Error("createShare failed: errno=" + r.data.errno);
  }
  var shareUrl = r.data.data.link || ("https://pan.baidu.com/s/" + r.data.data.shareid);
  return { url: shareUrl, pwd: r.data.data.pwd || "" };
}

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function transfer(url, bduss) {
  var surl = parseUrl(url);
  if (!surl) throw new Error("Invalid Baidu URL: " + url);

  var pwdMatch = url.match(/[?&]pwd=([^&]+)/);
  var passcode = pwdMatch ? pwdMatch[1] : "";

  // Get share info + verify password (if needed)
  var info = await getShareDetail(surl, bduss, passcode);
  var shareid = info.shareid;
  var uk = info.uk;

  if (!bduss) throw new Error("BDUSS not configured - please add in admin panel");

  // Ensure dir exists
  var targetPath = await ensureDir(bduss);

  // Get file list from the share
  var listResp = await api("GET", "/share/list?shareid=" + shareid + "&uk=" + uk +
    "&page=1&num=100&web=1&app_id=" + APP_ID, info.cookies);
  if (listResp.data.errno !== 0) throw new Error("list share files failed: errno=" + listResp.data.errno + " " + (listResp.data.show_msg || ""));

  var files = listResp.data.data ? listResp.data.data.list || [] : [];
  if (files.length === 0) throw new Error("no files found in share");

  var fsids = files.map(function(f) { return f.fs_id; });
  var transferResult = await transferFiles(shareid, uk, fsids, targetPath, bduss);

  if (transferResult.task_id) {
    // Poll for task completion
    var retries = 0;
    while (retries < 60) {
      await wait(1000);
      var taskResp = await api("GET", "/share/transfer?operate=query&task_id=" + transferResult.task_id + "&web=1", bduss);
      if (taskResp.data.errno === 0) break;
      retries++;
    }
  } else {
    await wait(3000);
  }

  // List dir to find saved files
  var savedFiles = await listDir(targetPath, bduss);
  if (savedFiles.length === 0) throw new Error("no files found after transfer");

  // Create new share
  var shareResult = await createShare(savedFiles[0].fs_id, bduss);
  return {
    url: shareResult.url,
    pwd: shareResult.pwd || "",
    saved: true,
    fileName: savedFiles[0].server_filename || ""
  };
}

module.exports = { transfer, getShareDetail, createShare, parseUrl, ensureDir, listDir };