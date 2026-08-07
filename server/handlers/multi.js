// 多源搜索聚合层：并发调各源适配器，统一 merged_by_type 结构（与 /api/pansou 前端兼容）
const { json } = require("../middleware");
const store = require("../../lib/store");
const registry = require("../../lib/sources/registry");

// 展示名统一走 registry.getSourceLabels(cfg)：配置 name 优先，缺省 registry.short

function mergeByType(items) {
  var byType = {};
  items.forEach(function (it) {
    var t = it.disk_type || "other";
    if (!byType[t]) byType[t] = [];
    byType[t].push(it);
  });
  return byType;
}

async function multiSearch(req, res) {
  var u = new URL(req.url, "http://" + req.headers.host);
  var kw = (u.searchParams.get("kw") || "").trim();
  var sourcesParam = u.searchParams.get("sources") || "all";
  var maxPerSource = parseInt(u.searchParams.get("max") || "10", 10) || 10;

  if (!kw) return json(res, 400, { code: 400, message: "kw required" });
  if (kw.length > 100) return json(res, 400, { code: 400, message: "kw too long" });

  var cfg = await store.getConfig();
  var ids = registry.resolveSources(sourcesParam, cfg);
  if (!ids.length) return json(res, 200, { code: 0, data: { total: 0, merged_by_type: {}, per_source: {}, errors: { all: "无可用源（全部被禁用）" } } });

  // 源级软超时：单个源最多 8s，防止慢源拖垮整体（浏览器源超时后标记，不影响其他源）
  var SOFT_TIMEOUT = 8000;
  function withTimeout(p, id) {
    return Promise.race([p, new Promise(function (r) {
      setTimeout(function () { r({ id: id, ok: false, error: "timeout" }); }, SOFT_TIMEOUT);
    })]);
  }

  var results = await Promise.all(ids.map(function (id) {
    var adapter = registry.loadAdapter(id);
    if (!adapter) return Promise.resolve({ id: id, ok: false, error: "adapter 加载失败" });
    return withTimeout(adapter.search(kw, {}).then(function (r) { return Object.assign({ id: id }, r); })
      .catch(function (e) { return { id: id, ok: false, error: e.message }; }), id);
  }));

  var allItems = [];
  var perSource = {};
  var errors = {};
  results.forEach(function (r) {
    if (r.ok && Array.isArray(r.items)) {
      // 源级网盘限制：该源配置的 disks 非空时，过滤掉非指定盘的条目（兜底，不依赖源 API）
      var disks = registry.getSourceDisks(r.id, cfg);
      var list = r.items;
      if (disks && disks.length) {
        list = list.filter(function (it) { return disks.indexOf(it.disk_type) >= 0; });
      }
      list = list.slice(0, maxPerSource);
      perSource[r.id] = list.length;
      allItems = allItems.concat(list);
    } else {
      perSource[r.id] = 0;
      errors[r.id] = r.error || "unknown";
    }
  });

  // 简单去重：同 url 只留第一个（保留源标记）
  var seen = {};
  var dedup = [];
  allItems.forEach(function (it) {
    var k = it.url;
    if (!k || seen[k]) return;
    seen[k] = 1;
    dedup.push(it);
  });

  var resp = {
    code: 0,
    data: {
      total: dedup.length,
      merged_by_type: mergeByType(dedup),
      per_source: perSource,
      source_labels: registry.getSourceLabels(cfg),
      errors: errors,
    },
  };
  json(res, 200, resp);
}

// GET /api/multi/sources — 公开：搜索源 id + 展示名 + 启停（搜索页源 tab / 来源徽标用）
async function sourceList(req, res) {
  try {
    var cfg = await store.getConfig();
    var labels = registry.getSourceLabels(cfg);
    var enabledSet = registry.getEnabledSet(cfg);
    var items = Object.keys(registry.REGISTRY).map(function (id) {
      return { id: id, name: labels[id], enabled: !!enabledSet[id] };
    });
    json(res, 200, { items: items });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { multiSearch, sourceList };
