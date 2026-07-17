const { fetchHttps, json } = require("../middleware");
const { rd, wr, PATHS, PANSOU_BASE } = require("../../lib/storage");
const { getDoubanHot } = require("./douban");

const HOT_TERMS = ["狂飙", "繁花", "三体", "庆余年", "周杰伦", "肖申克的救赎", "年会不能停"];

async function getTrending(req, res) {
  var cache = rd(PATHS.CACHE, {});
  var trending = cache.trending;
  var now = Date.now();

  if (trending && now - trending.ts < 30 * 60 * 1000) {
    return json(res, 200, trending.data);
  }

  // Try pansou API first
  var items = [];
  var source = "pansou";
  try {
    var cfg = rd(PATHS.CFG, {});
    var base = cfg.pansouBase || PANSOU_BASE;
    var batchTerms = HOT_TERMS.slice(0, 4);
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

  var qCount=0,bCount=0;items.forEach(function(i){if(i.type==="quark")qCount++;if(i.type==="baidu")bCount++});if(items.length>0){cache.stats={total:items.length,quark:qCount,baidu:bCount};wr(PATHS.CACHE,cache)}var out = {
    items: items.slice(0, 12),
    terms: source === "pansou" ? HOT_TERMS : items.slice(0, 8).map(function(i) { return i.term; }),
    stats: cache.stats || {},
    source: source
  };
  cache.trending = { ts: now, data: out };
  wr(PATHS.CACHE, cache);

  json(res, 200, out);
}

module.exports = { getTrending, HOT_TERMS };
