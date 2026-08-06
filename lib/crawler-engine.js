// lib/crawler-engine.js — 资源入库三管道之三「自动采集」核心引擎（零依赖）
// 支持 source_type: rss / page / api；rule_type: regex / jsonpath / fixed / concat（css 需 cheerio，暂降级）
// 用法: await crawlSource(source, rules) → {status, crawled, inserted, skipped, error}
const http = require("http");
const https = require("https");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// fetchText(url, encoding, timeoutMs, retries)
// retries: 总尝试次数（默认 3 = 1 次原始 + 2 次重试）；HTTP 429 限流时按 1.5s/3s 递增缓冲重试
function fetchText(url, encoding, timeoutMs, retries) {
  return new Promise(function (resolve, reject) {
    var max = (retries === undefined ? 3 : retries);
    var attempt = 0;
    function doFetch() {
      var lib = url.startsWith("https") ? https : http;
      var t;
      var req = lib.get(url, { headers: { "User-Agent": UA, "Accept": "*/*" } }, function (r) {
        var chunks = [];
        r.on("data", function (c) { chunks.push(c); });
        r.on("end", function () {
          if (t) clearTimeout(t);
          var buf = Buffer.concat(chunks);
          var text;
          try {
            var enc = String(encoding || "utf-8").toLowerCase();
            if (enc === "utf-8" || enc === "utf8") text = buf.toString("utf8");
            else text = new TextDecoder(enc).decode(buf);
          } catch (e) { text = buf.toString("utf8"); }
          // 429 限流：递增缓冲后重试（1.5s * attempt），避免并发触发 RSSHub/TG 限流
          if (r.statusCode === 429 && attempt < max - 1) {
            attempt++;
            setTimeout(doFetch, 1500 * attempt);
            return;
          }
          resolve({ status: r.statusCode, text: text });
        });
      });
      req.on("error", function (e) {
        if (attempt < max - 1) { attempt++; setTimeout(doFetch, 1000); return; }
        reject(e);
      });
      req.setTimeout(timeoutMs || 15000, function () { req.destroy(new Error("timeout")); });
    }
    doFetch();
  });
}

// ---------- 条目定位 ----------
function rssItems(xml) {
  // 简易 RSS/Atom 解析：取 <item>…</item> 块（Atom 兼容 <entry>）
  var items = [], re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi, m;
  while ((m = re.exec(xml))) items.push(m[2]);
  return items;
}
function pageItems(html, itemRegex) {
  if (!itemRegex) {
    // 默认：取所有带链接的 <a> 片段（列表页兜底）
    var items = [], re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(html)) && items.length < 500) items.push("<a href=\"" + m[1] + "\">" + m[2] + "</a>");
    return items;
  }
  var out = [], re = new RegExp(itemRegex, "gi"), mm;
  while ((mm = re.exec(html)) && out.length < 500) out.push(mm[1] || mm[0]);
  return out;
}
function apiItems(json, listPath) {
  if (Array.isArray(json)) return json;
  var parts = String(listPath || "").split(".").filter(Boolean);
  var cur = json;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return [];
    var k = parts[i], idx = k.match(/^(\w+)\[(\d+)\]$/);
    if (idx) { cur = cur[idx[1]]; if (Array.isArray(cur)) cur = cur[parseInt(idx[2], 10)]; }
    else cur = cur[k];
  }
  return Array.isArray(cur) ? cur : [];
}

// ---------- 字段提取 ----------
function jsonpathGet(obj, path) {
  var parts = String(path || "").replace(/^\$\.?/, "").split(".").filter(Boolean);
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return "";
    var k = parts[i], idx = k.match(/^(\w+)\[(\d+)\]$/);
    if (idx) { cur = cur[idx[1]]; if (Array.isArray(cur)) cur = cur[parseInt(idx[2], 10)]; }
    else cur = cur[k];
  }
  return cur == null ? "" : (typeof cur === "object" ? JSON.stringify(cur) : String(cur));
}
function extractField(item, rule, itemText) {
  var ruleType = rule.rule_type || "regex";
  var val = "";
  try {
    if (ruleType === "fixed") val = rule.default_value || rule.rule_value || "";
    else if (ruleType === "jsonpath") val = jsonpathGet(item, rule.rule_value);
    else if (ruleType === "concat") {
      var parts = String(rule.rule_value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      val = parts.map(function (p) { return jsonpathGet(item, p); }).join("");
    }
    else if (ruleType === "css") {
      // 第一阶段无 cheerio：page 类型可从 itemText 正则提取，否则用默认值
      val = rule.default_value || "";
    }
    else { // regex（默认）：对 itemText 或 JSON 序列化文本匹配，取第一个捕获组（多分支规则取第一个非空捕获组）
      var hay = ruleType === "regex" && itemText ? itemText : (typeof item === "string" ? item : JSON.stringify(item || {}));
      hay = hay.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"); // 匹配前展开 CDATA（RSS 常见）
      var re = new RegExp(rule.rule_value, "i");
      var m = re.exec(hay);
      if (m) {
        if (m[1] !== undefined && m[1] !== "") val = m[1];
        else {
          var found = "";
          for (var gi = 2; gi < m.length; gi++) {
            if (m[gi] !== undefined && m[gi] !== "") { found = m[gi]; break; }
          }
          val = found || (m[1] !== undefined ? m[1] : m[0]);
        }
      }
    }
  } catch (e) { val = ""; }
  val = String(val || "").trim();
  if (val) val = val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(); // 剥离 CDATA（RSS 常见）
  if (val && rule.filter_regex) {
    try {
      var fr = new RegExp(rule.filter_regex, "i");
      var fm = fr.exec(val);
      if (fm) val = fm[1] !== undefined ? fm[1] : fm[0];
      else val = "";
    } catch (e) { val = ""; }
  }
  if (!val && rule.default_value) val = String(rule.default_value).trim();
  if (rule.field_name === "url") val = val.replace(/^\/\//, "https://");
  return val;
}

// ---------- 主流程 ----------
async function crawlSource(source, rules, ctx) {
  ctx = ctx || {};
  var result = { status: "ok", crawled: 0, inserted: 0, skipped: 0, error: "" };
  var store = require("./store");
  var page = Math.max(parseInt(source.page_start || "1", 10), 1);
  var pageEnd = Math.max(parseInt(source.page_end || "1", 10), page);
  var ruleMap = {};
  (rules || []).forEach(function (r) { ruleMap[r.field_name] = r; });

  try {
    for (var p = page; p <= pageEnd; p++) {
      var url = String(source.url_template || "").replace("{page}", p);
      if (!/^https?:\/\//i.test(url)) { result.error = "url_template 无效"; result.status = "failed"; break; }
      var resp;
      try { resp = await fetchText(url, source.encoding); }
      catch (e) { result.error = "抓取失败: " + e.message; result.status = "failed"; break; }
      if (resp.status !== 200) { result.error = "HTTP " + resp.status; result.status = "failed"; break; }

      var items = [];
      if (source.source_type === "rss") items = rssItems(resp.text);
      else if (source.source_type === "page") items = pageItems(resp.text, ruleMap["__item__"] ? ruleMap["__item__"].rule_value : "");
      else if (source.source_type === "api") {
        var j;
        try { j = JSON.parse(resp.text); } catch (e) { result.error = "JSON 解析失败"; result.status = "failed"; break; }
        items = apiItems(j, ruleMap["__list__"] ? ruleMap["__list__"].rule_value : "");
      }

      for (var i = 0; i < items.length; i++) {
        result.crawled++;
        var item = items[i];
        var itemText = typeof item === "string" ? item : "";
        var rec = {};
        var ok = true;
        for (var f in ruleMap) {
          if (f === "__item__" || f === "__list__") continue;
          var val = extractField(item, ruleMap[f], itemText);
          rec[f] = val;
          if (ruleMap[f].required && !val) { ok = false; break; }
        }
        if (!ok || !rec.title || !rec.url) { result.skipped++; continue; }
        rec.disk_type = rec.disk_type || source.disk_type || "quark";
        rec.category = rec.category || source.category || "";
        rec.source = "collected";
        rec.source_id = String(source.id);
        rec.status = 1;
        // URL 去重
        var dup = false;
        try { dup = await store.resourceExists(rec.url); } catch (e) {}
        if (dup) { result.skipped++; continue; }
        if (ctx.dryRun) { result.inserted++; continue; } // 试运行只统计不写库
        try { await store.resourceAdd(rec); result.inserted++; }
        catch (e) { result.skipped++; }
      }
    }
  } catch (e) { result.error = e.message; result.status = "failed"; }
  return result;
}

module.exports = { fetchText, crawlSource, rssItems, pageItems, apiItems, extractField };
