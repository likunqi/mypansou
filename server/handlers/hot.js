const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

// 热搜关键词榜：手动 is_hot 词优先（sort_order），再按 search_count 排真实采集词
async function getKeywords(req, res) {
  try {
    var list = await store.keywordList(50, false);
    var items = (list || []).map(function (k) {
      return { keyword: k.keyword, search_count: k.search_count || 0, is_hot: k.is_hot ? 1 : 0, sort_order: k.sort_order || 0, source: k.source || "" };
    });
    // 手动置顶词（is_hot）按 sort_order 在前，其余按 search_count
    var manual = items.filter(function (i) { return i.is_hot === 1; }).sort(function (a, b) { return b.sort_order - a.sort_order || b.search_count - a.search_count; });
    var auto = items.filter(function (i) { return i.is_hot !== 1; }).sort(function (a, b) { return b.search_count - a.search_count; });
    var merged = manual.concat(auto).slice(0, 10);
    json(res, 200, { items: merged, total: merged.length, source: "keywords" });
  } catch (e) {
    json(res, 502, { error: "keywords_error", message: e.message });
  }
}

// 资源库真实统计（首页收录数字）：按 disk_type 汇总 + 有效链接数
async function getStats(req, res) {
  try {
    var st = await store.resourceStats();
    json(res, 200, st);
  } catch (e) {
    json(res, 502, { error: "stats_error", message: e.message });
  }
}

// 资源热度榜（前台）：手动入榜（hot_rankings）按 sort_order 排前，不足 8 条按转存热度补位
async function getHotResources(req, res) {
  try {
    var items = [];
    var seen = {};
    // 1. 手动入榜资源（后台拖拽排序）
    try {
      var manual = await store.hotRankList();
      (manual || []).forEach(function (r) {
        if (r.url && seen[r.url]) return;
        if (r.url) seen[r.url] = true;
        items.push({ rank: items.length + 1, title: r.title || "", url: r.url || "", disk_type: r.disk_type || "", category: r.category || "", count: -1, manual: true });
      });
    } catch (e) {}
    // 2. 不足 8 条：按转存热度补位（过滤已在手动榜的 url）
    if (items.length < 8) {
      var hot = await store.hotResources(8);
      (hot || []).forEach(function (r) {
        if (items.length >= 8) return;
        if (r.url && seen[r.url]) return;
        if (r.url) seen[r.url] = true;
        items.push({ rank: items.length + 1, title: r.title || "", url: r.url || "", disk_type: r.disk_type || "", category: r.category || "", count: r.cnt || 0, manual: false });
      });
    }
    json(res, 200, { items: items, total: items.length, source: "manual+transfer" });
  } catch (e) {
    json(res, 502, { error: "hot_resources_error", message: e.message });
  }
}

// ---------- 后台资源热榜管理 ----------
async function adminHotList(req, res) {
  try {
    var rows = await store.hotRankList();
    json(res, 200, { items: rows || [], total: (rows || []).length });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 入榜：{resource_id} → 从 resources 取快照写入 hot_rankings
async function adminHotAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var rid = parseInt(b.resource_id, 10);
    if (!rid) { json(res, 400, { error: "resource_id_required" }); return; }
    var r = await store.resourceGet(rid);
    if (!r) { json(res, 404, { error: "resource_not_found" }); return; }
    await store.hotRankAdd({ id: rid, title: r.title, url: r.url, disk_type: r.disk_type, category: r.category });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 拖拽排序：{ids:[id,...]}
async function adminHotSaveSort(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var n = await store.hotRankSaveSort(b.ids || []);
    json(res, 200, { ok: true, saved: n });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 移除热榜：{id}（hot_rankings.id）
async function adminHotRemove(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    await store.hotRankRemove(parseInt(b.id, 10) || 0);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 已入榜的 resource_id 集合（资源列表按钮状态用）
async function adminHotRankedIds(req, res) {
  try {
    var ids = await store.hotRankedIds();
    json(res, 200, { ids: ids || [] });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 手动触发豆瓣热词采集（复用 douban_hotwords 任务逻辑）
async function adminKeywordCollect(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    var top = parseInt(b.top || "10", 10);
    var douban = require("./douban");
    var data = await douban.getDoubanHot();
    var items = (data && data.items) || [];
    var titles = items.slice(0, top).map(function (m) { return (m.title || "").trim(); }).filter(Boolean);
    var inserted = 0;
    for (var i = 0; i < titles.length; i++) {
      try { await store.keywordCollect(titles[i], "douban"); inserted++; } catch (e) {}
    }
    json(res, 200, { ok: true, collected: inserted, total: titles.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 资源库最新资源（首页「最新资源」垂直滚动）
async function getLatest(req, res) {
  try {
    var r = await store.resourceSearch({ status: 1, page: 1, size: 8 });
    var items = (r.items || []).map(function (x) {
      return {
        title: x.title || "",
        url: x.url || "",
        password: x.password || "",
        disk_type: x.disk_type || "",
        category: x.category || "",
        description: x.description || "",
        thumbnail: x.thumbnail || "",
        created_at: x.created_at || ""
      };
    });
    json(res, 200, { items: items, total: items.length, source: "resources" });
  } catch (e) {
    json(res, 502, { error: "latest_error", message: e.message });
  }
}

// 搜索词上报（前台 fire-and-forget）
async function recordSearch(req, res) {
  try {
    var b = JSON.parse(await readBody(req) || "{}");
    var kw = String(b.kw || "").trim().slice(0, 50);
    if (kw) await store.keywordRecord(kw);
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 200, { ok: false }); // 上报失败不阻塞搜索，静默
  }
}

// 首页站点信息聚合（站点数据卡）：分类列表+计数 / 今日新增 / 累计转存 / 热搜词数 / 累计搜索次数
async function getSiteInfo(req, res) {
  try {
    var mysql = require("../../lib/mysql");
    var [cats, today, transfers, kws, searches] = await Promise.all([
      mysql.query("SELECT category AS name, COUNT(*) AS count FROM resources WHERE status=1 AND category<>'' AND category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 10"),
      mysql.query("SELECT COUNT(*) AS c FROM resources WHERE created_at >= CURDATE()"),
      mysql.query("SELECT COUNT(*) AS c FROM transfer_history"),
      mysql.query("SELECT COUNT(DISTINCT keyword) AS c FROM search_keywords"),
      mysql.query("SELECT COALESCE(SUM(search_count),0) AS c FROM search_keywords")
    ]);
    json(res, 200, {
      categories: (cats || []).map(function (x) { return { name: x.name, count: x.count }; }),
      today: (today && today[0]) ? today[0].c : 0,
      transfers: (transfers && transfers[0]) ? transfers[0].c : 0,
      keywords: (kws && kws[0]) ? kws[0].c : 0,
      searches: (searches && searches[0]) ? searches[0].c : 0
    });
  } catch (e) { json(res, 502, { error: "site_error", message: e.message }); }
}

// ---------- 后台热搜词管理（/api/admin/keywords*，需登录） ----------
async function adminKeywordList(req, res) {
  try {
    var list = await store.keywordList(100, false);
    json(res, 200, { items: list || [], total: (list || []).length });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function adminKeywordAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var kw = String(b.keyword || "").trim().slice(0, 50);
    if (!kw) { json(res, 400, { error: "keyword_required" }); return; }
    await store.keywordEnsure(kw, { is_hot: b.is_hot ? 1 : 0, sort_order: b.sort_order || 0, status: 1, source: b.source || "manual" });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}
// 拖拽排序：ids 按序写 sort_order=1..N 且置顶（is_hot=1）
async function adminKeywordSort(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var ids = Array.isArray(b.ids) ? b.ids : [];
    for (var i = 0; i < ids.length; i++) {
      await store.keywordUpdate(parseInt(ids[i], 10) || 0, { sort_order: i + 1, is_hot: 1 });
    }
    json(res, 200, { ok: true, saved: ids.length });
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function adminKeywordUpdate(req, res) {
  try {
    var m = req.url.match(/\/api\/admin\/keywords\/(\d+)/);
    if (!m) { json(res, 400, { error: "bad_id" }); return; }
    var b = JSON.parse(await readBody(req));
    var fields = {};
    if (b.keyword !== undefined && String(b.keyword).trim()) fields.keyword = String(b.keyword).trim();
    if (b.is_hot !== undefined) fields.is_hot = b.is_hot ? 1 : 0;
    if (b.sort_order !== undefined) fields.sort_order = parseInt(b.sort_order || "0", 10) || 0;
    if (b.status !== undefined) fields.status = b.status ? 1 : 0;
    await store.keywordUpdate(m[1], fields);
    json(res, 200, { ok: true });
  } catch (e) {
    if (e && e.errno === 1062) { json(res, 400, { error: "该关键词已存在" }); return; }
    json(res, 500, { error: e.message });
  }
}
async function adminKeywordDelete(req, res) {
  try {
    var m = req.url.match(/\/api\/admin\/keywords\/(\d+)\/delete/);
    if (!m) { json(res, 400, { error: "bad_id" }); return; }
    await store.keywordDelete(m[1]);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

async function getTrending(req, res) {
  try {
    var cache = store.getTrendingCache();
    var trending = cache.trending;
    var now = Date.now();

    if (trending && now - trending.ts < 30 * 60 * 1000) {
      return json(res, 200, trending.data);
    }

    var out = await refreshTrending();
    json(res, 200, out);
  } catch (e) {
    // 查询失败时兜底返回缓存（可能过期），不把错误抛给前端
    var cache2 = store.getTrendingCache();
    if (cache2.trending && cache2.trending.data) return json(res, 200, cache2.trending.data);
    json(res, 502, { error: "trending_error", message: e.message });
  }
}

// 构建热搜词（纯数据库）：search_keywords 表真实词优先（含 douban_hotwords 定时任务写入的豆瓣热词 + 手动置顶）
async function buildTrending() {
  var terms = [];
  try {
    var kwList = await store.keywordList(10, false);
    var real = (kwList || []).map(function (k) { return k.keyword; }).filter(Boolean);
    terms = real.slice(0, 8);
  } catch (e) {}
  // 词不足 4 个时用资源库热门标题兜底（保证 hero 标签不空）
  if (terms.length < 4) {
    try {
      var hot = await store.hotResources(8);
      (hot || []).forEach(function (r) {
        if (r.title && terms.indexOf(r.title) < 0) terms.push(String(r.title).slice(0, 20));
      });
      terms = terms.slice(0, 8);
    } catch (e) {}
  }
  return { items: [], terms: terms, stats: { total: 0, quark: 0, baidu: 0 }, source: "database" };
}

// 刷新热搜词缓存（供 getTrending 与定时预热任务共用，纯数据库查询，毫秒级）
async function refreshTrending() {
  var cache = store.getTrendingCache();
  var now = Date.now();
  var out = await buildTrending();
  cache.trending = { ts: now, data: out };
  store.saveTrendingCache(cache);
  return out;
}

module.exports = { getTrending, getKeywords, getHotResources, getLatest, getStats, getSiteInfo, recordSearch, adminKeywordList, adminKeywordAdd, adminKeywordSort, adminKeywordUpdate, adminKeywordDelete, refreshTrending, buildTrending, adminHotList, adminHotAdd, adminHotSaveSort, adminHotRemove, adminHotRankedIds, adminKeywordCollect };
