// 源适配器：NAS pansou（复用现有代理逻辑，返回统一结果结构）
const { fetchHttps } = require("../../server/middleware");
const store = require("../../lib/store");

const ALLOWED = ["quark", "baidu"];

async function search(kw, opts) {
  try {
    var cfg = await store.getConfig();
    var base = cfg.pansouBase || (require("../../lib/storage").PANSOU_BASE);
    var path = "/api/search?kw=" + encodeURIComponent(kw);
    var pr = await fetchHttps(base, path);
    if (pr.status >= 500) return { ok: false, error: "pansou status " + pr.status };
    var parsed;
    try { parsed = JSON.parse(pr.body); } catch (e) {
      return { ok: false, error: "pansou non-JSON" };
    }
    var dt = (parsed && parsed.data) || {};
    var mg = dt.merged_by_type || dt.mergedResults || {};
    var items = [];
    Object.keys(mg).forEach(function (k) {
      if (ALLOWED.indexOf(k) < 0 || !Array.isArray(mg[k])) return;
      mg[k].forEach(function (it) {
        if (!it || !it.url) return;
        items.push({
          title: it.note || it.title || "未命名",
          url: it.url,
          pwd: it.password || "",
          disk_type: k,
          source: "pansou",
          extra: { src: it.source || "", images: it.images || [] },
        });
      });
    });
    return { ok: true, items: items, total: items.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { search };
