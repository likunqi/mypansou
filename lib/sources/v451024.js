// 源适配器：451024 影视搜索（apis.451024.xyz）
// 接口：POST /api/media/search  body {title, page, size}  → {data:[{id,title,link,link_type,created_at,content,tags}], total}
const https = require("https");

const API_BASE = "apis.451024.xyz";

function postJson(path, body) {
  return new Promise(function (resolve, reject) {
    var data = JSON.stringify(body);
    var req = https.request({
      hostname: API_BASE,
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      rejectUnauthorized: false,
      timeout: 12000,
    }, function (res) {
      var d = "";
      res.on("data", function (c) { d += c; });
      res.on("end", function () {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: { error: "non-json" } }); }
      });
    });
    req.on("timeout", function () { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function search(kw, opts) {
  try {
    var r = await postJson("/api/media/search", { title: kw, page: 1, size: 10 });
    if (r.status !== 200) return { ok: false, error: "v451024 status " + r.status };
    var data = r.body && r.body.data;
    if (!Array.isArray(data)) return { ok: false, error: (r.body && r.body.error) || "v451024 no data" };
    var items = data.map(function (it) {
      var pwd = "";
      var m = (it.link || "").match(/[?&]pwd=([a-zA-Z0-9]+)/);
      if (m) pwd = m[1];
      var type = String(it.link_type || "other").toLowerCase();
      if (type === "alipan") type = "aliyun";
      return {
        title: it.title || "未命名",
        url: it.link,
        pwd: pwd,
        disk_type: type,
        source: "v451024",
        extra: { id: it.id, created_at: it.created_at, content: it.content, tags: it.tags },
      };
    }).filter(function (it) { return it.url; });
    return { ok: true, items: items, total: (r.body && r.body.total) || items.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { search };
