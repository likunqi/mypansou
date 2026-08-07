// 源适配器：泽索搜 zreso.cn（免费公开网盘搜索 API）
// 接口：GET /api/search?q=关键词 → data.results[]（title/datetime/cloud_type_name/links[]）
//      每条链接是 /api/wash?t=xxx → 返回 raw_url 真实网盘链接（夸克/百度/迅雷/UC）
// 限流说明：zreso 对短时高频请求返回 429，adapter 内置内存缓存（同词 5min）+ 429 退避重试
const https = require("https");

const API_HOST = "zreso.cn";
const MAX_WASH = 10; // wash 接口逐个请求，只洗前 N 条，避免太慢/限流
const CACHE_TTL = 10 * 60 * 1000; // 同关键词缓存 10 分钟（zreso API 有 Cloudflare Turnstile，高频请求会 429）
var cache = {}; // {kw: {expire, data}}

function getJson(path) {
  return new Promise(function (resolve, reject) {
    var req = https.request({
      hostname: API_HOST,
      path: path,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
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
    req.end();
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// 带 429 退避的 GET：最多重试 2 次（等 1s / 2s）
async function getJsonRetry(path, retry) {
  var n = retry || 0;
  var r = await getJson(path);
  if (r.status === 429 && n < 2) {
    await sleep((n + 1) * 1000);
    return getJsonRetry(path, n + 1);
  }
  return r;
}

// wash 接口拿真实链接（串行，防限流）
async function washUrl(washPath) {
  try {
    var r = await getJsonRetry(washPath);
    if (r.status !== 200 || !r.body) return "";
    var d = r.body;
    if (d.ok === false || !d.raw_url) return "";
    return d.raw_url;
  } catch (e) { return ""; }
}

async function search(kw, opts) {
  var key = String(kw || "").trim();
  if (!key) return { ok: true, items: [], total: 0 };

  // 命中缓存直接返回
  var hit = cache[key];
  if (hit && hit.expire > Date.now()) {
    return { ok: true, items: hit.data, total: hit.data.length, cached: true };
  }

  try {
    var r = await getJsonRetry("/api/search?q=" + encodeURIComponent(key));
    if (r.status === 429) {
      // Turnstile 人机验证触发：返回明确错误（multi 层会标记该源失败，其他源不受影响）
      var turn = /TURNSTILE/i.test(String((r.body && r.body.error) || ""));
      return { ok: false, error: turn ? "泽索搜触发人机验证，请稍后再试" : "泽索搜限流(429)" };
    }
    if (r.status !== 200) return { ok: false, error: "zreso status " + r.status };
    var data = r.body && r.body.data;
    var results = data && Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      cache[key] = { expire: Date.now() + CACHE_TTL, data: [] };
      return { ok: true, items: [], total: 0 };
    }

    // 只处理前 MAX_WASH 条，逐条 wash 拿真实链接
    var items = [];
    for (var i = 0; i < Math.min(results.length, MAX_WASH); i++) {
      var it = results[i];
      var links = Array.isArray(it.links) ? it.links : [];
      var first = links[0] || {};
      var url = await washUrl(first.url);
      if (!url) continue; // wash 失败（链接失效或限流）跳过
      var type = String(first.type || "other").toLowerCase();
      if (type === "alipan") type = "aliyun";
      items.push({
        title: it.title || "未命名",
        url: url,
        pwd: "", // zreso 无提取码字段（二维码扫码保存）
        disk_type: type,
        source: "zreso",
        extra: { datetime: it.datetime || "", cloud: it.cloud_type_name || "", tags: it.tags || [] },
      });
    }
    cache[key] = { expire: Date.now() + CACHE_TTL, data: items };
    return { ok: true, items: items, total: items.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { search };
