// 源适配器：NAS pansou（复用现有代理逻辑，返回统一结果结构）
const { fetchHttps } = require("../../server/middleware");
const store = require("../../lib/store");

const ALLOWED = ["quark", "baidu"];

async function search(kw, opts) {
  var bases = await store.getPansouBases();
  var tried = {};
  var lastErr = null;
  for (var n = 0; n < bases.length; n++) {
    var picked = store.pickPansouBase(bases.filter(function (h) { return !tried[h.host]; }));
    if (!picked) break;
    tried[picked.host] = 1;
    try {
      var path = "/api/search?kw=" + encodeURIComponent(kw);
      var pr = await fetchHttps(picked.host, path);
      if (pr.status >= 500) { lastErr = "pansou status " + pr.status; continue; }
      var parsed;
      try { parsed = JSON.parse(pr.body); } catch (e) {
        lastErr = "pansou non-JSON"; continue;
      }
      var dt = (parsed && parsed.data) || {};
      var mg = dt.merged_by_type || dt.mergedResults || {};
      var items = [];
      Object.keys(mg).forEach(function (k) {
        if (ALLOWED.indexOf(k) < 0 || !Array.isArray(mg[k])) return;
        mg[k].forEach(function (it) {
          if (!it || !it.url) return;
          // NAS pansou 的 datetime 可能是 Go 零值（0001-01-01），无时间时不显示
          var dtt = it.datetime || "";
          if (/^0001-01-01/.test(dtt)) dtt = "";
          items.push({
            title: it.note || it.title || "未命名",
            url: it.url,
            pwd: it.password || "",
            disk_type: k,
            source: "pansou",
            extra: { src: it.source || "", images: it.images || [], datetime: dtt },
          });
        });
      });
      return { ok: true, items: items, total: items.length, host: picked.host };
    } catch (e) {
      lastErr = e.message;
    }
  }
  return { ok: false, error: lastErr || "all pansou hosts failed" };
}

module.exports = { search };
