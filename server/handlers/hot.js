const { fetchHttps, json, readBody } = require("../middleware");
const store = require("../../lib/store");
const { getDoubanHot } = require("./douban");

const HOT_TERMS = ["狂飙", "繁花", "三体", "庆余年", "周杰伦", "肖申克的救赎", "年会不能停"];

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

// 资源热度榜：按转存历史聚合被转存最多的资源 Top N
async function getHotResources(req, res) {
  try {
    var rows = await store.hotResources(12);
    var items = (rows || []).map(function (r, i) {
      return {
        rank: i + 1,
        originalUrl: r.original_url || "",
        title: r.title || r.original_url || "",
        count: r.cnt || 0,
        type: r.type || ""
      };
    });
    json(res, 200, { items: items, total: items.length, source: "transfer" });
  } catch (e) {
    json(res, 502, { error: "hot_resources_error", message: e.message });
  }
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

// 首页站点信息聚合（分类导航墙 + 站点数据卡）：分类列表+计数 / 今日新增 / 累计转存 / 热搜词数
async function getSiteInfo(req, res) {
  try {
    var mysql = require("../../lib/mysql");
    var [cats, today, transfers, kws] = await Promise.all([
      mysql.query("SELECT category AS name, COUNT(*) AS count FROM resources WHERE status=1 AND category<>'' AND category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 10"),
      mysql.query("SELECT COUNT(*) AS c FROM resources WHERE created_at >= CURDATE()"),
      mysql.query("SELECT COUNT(*) AS c FROM transfer_history"),
      mysql.query("SELECT COUNT(DISTINCT keyword) AS c FROM search_keywords")
    ]);
    json(res, 200, {
      categories: (cats || []).map(function (x) { return { name: x.name, count: x.count }; }),
      today: (today && today[0]) ? today[0].c : 0,
      transfers: (transfers && transfers[0]) ? transfers[0].c : 0,
      keywords: (kws && kws[0]) ? kws[0].c : 0
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
    await store.keywordEnsure(kw, { is_hot: b.is_hot ? 1 : 0, sort_order: b.sort_order || 0, status: 1 });
    json(res, 200, { ok: true });
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
    // 采集失败时兜底返回缓存（可能过期），不把错误抛给前端
    var cache2 = store.getTrendingCache();
    if (cache2.trending && cache2.trending.data) return json(res, 200, cache2.trending.data);
    json(res, 502, { error: "trending_error", message: e.message });
  }
}

// 采集热门推荐数据并写入缓存（供 getTrending 与定时预热任务共用）
async function refreshTrending() {
  var cache = store.getTrendingCache();
  var now = Date.now();

  // 热搜词：优先真实采集/手动维护词，不足用默认兜底
  var terms = HOT_TERMS.slice();
  try {
    var kwList = await store.keywordList(8, false);
    var real = (kwList || []).map(function (k) { return k.keyword; }).filter(Boolean);
    if (real.length >= 2) terms = real.concat(terms).slice(0, 8);
  } catch (e) {}

  // Try pansou API first（整体 15s 超时：盘搜源慢时快速降级 douban，避免手动触发/预热卡死）
  var items = [];
  var source = "pansou";
  try {
    var pb = store.pickPansouBase(await store.getPansouBases());
    if (!pb) throw new Error("no pansou host");
    var base = pb.host;
    var batchTerms = terms.slice(0, 4);
    var collect = (async function() {
      await Promise.all(batchTerms.map(async function(term) {
        try {
          var pr = await fetchHttps(
            base,
            "/api/search?kw=" + encodeURIComponent(term) + "&src=tg&cloud_types=quark,baidu"
          );
          if (pr.status !== 200) return;
          var data = JSON.parse(pr.body);
          var dt = data.data || data;
          var merged = dt.merged_by_type || dt.mergedResults || {};
          var termItems = [];
          Object.keys(merged).forEach(function(type) {
            (merged[type] || []).forEach(function(item) {
              termItems.push({
                term: term,
                title: item.title || item.note || term,
                note: item.note || "",
                type: type,
                url: item.url || "",
                password: item.password || "",
                cover: (item.images && item.images.length > 0) ? item.images[0] : "",
                datetime: item.datetime || ""
              });
            });
          });
          termItems.slice(0, 4).forEach(function(t) { items.push(t); });
        } catch(e) {}
      }));
    })();
    await Promise.race([collect, new Promise(function(resolve) { setTimeout(resolve, 15000); })]);
  } catch(e) {}

  // If pansou returned items but only from 1 term, also mix in Douban for diversity
  if (items.length > 0) {
    var uniqueTerms = {};
    items.forEach(function(it) { uniqueTerms[it.term] = true; });
    if (Object.keys(uniqueTerms).length < 2) {
      // Only 1 term -> fall back to Douban for variety
      items = [];
      source = "douban";
      try {
        var doubanData = await getDoubanHot();
        if (doubanData.items && doubanData.items.length > 0) {
          doubanData.items.forEach(function(movie) {
            items.push({
              term: movie.title,
              title: movie.title,
              note: movie.desc || "",
              type: "douban",
              url: movie.url || "",
              password: "",
              cover: movie.cover || "",
              datetime: "",
              rating: movie.rating || ""
            });
          });
        }
      } catch(e) {}
    }
  }

  // If pansou returned nothing, fall back to Douban
  if (items.length === 0) {
    source = "douban";
    try {
      var doubanData = await getDoubanHot();
      if (doubanData.items && doubanData.items.length > 0) {
        doubanData.items.forEach(function(movie) {
          items.push({
            term: movie.title,
            title: movie.title,
            note: movie.desc || "",
            type: "douban",
            url: movie.url || "",
            password: "",
            cover: movie.cover || "",
            datetime: "",
            rating: movie.rating || ""
          });
        });
      }
    } catch(e) {}
  }

  // Shuffle for variety
  for (var i = items.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
  }

  var qCount = 0, bCount = 0;
  items.forEach(function (i) { if (i.type === "quark") qCount++; if (i.type === "baidu") bCount++; });
  var stats = { total: items.length, quark: qCount, baidu: bCount };
  var out = {
    items: items.slice(0, 12),
    terms: source === "pansou" ? terms : items.slice(0, 8).map(function (i) { return i.term; }),
    stats: stats,
    source: source
  };
  cache.trending = { ts: now, data: out };
  store.saveTrendingCache(cache);

  return out;
}

module.exports = { getTrending, getKeywords, getHotResources, getLatest, getStats, getSiteInfo, recordSearch, adminKeywordList, adminKeywordAdd, adminKeywordUpdate, adminKeywordDelete, refreshTrending, HOT_TERMS };
