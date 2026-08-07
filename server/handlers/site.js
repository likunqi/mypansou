// server/handlers/site.js — 前台公告 + 广告位公开接口（读 site_config）
const { json } = require("../middleware");
const store = require("../../lib/store");

// GET /api/site/notice → { notices: [{content}] }（仅启用，供首页跑马灯）
async function getNotices(req, res) {
  try {
    var cfg = await store.getSiteConfig();
    var list = (cfg.site_notices || [])
      .filter(function (n) { return n && n.enabled && String(n.content || "").trim(); })
      .map(function (n) { return { content: String(n.content).trim() }; });
    json(res, 200, { notices: list });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// GET /api/site/ads → { ads: [{position,type,image,link,code}] }（仅启用）
async function getAds(req, res) {
  try {
    var cfg = await store.getSiteConfig();
    var list = (cfg.site_ads || [])
      .filter(function (a) { return a && a.enabled && a.position; })
      .map(function (a) {
        return {
          position: String(a.position),
          type: a.type === "code" ? "code" : "image",
          image: String(a.image || ""),
          link: String(a.link || ""),
          code: String(a.code || ""),
          name: String(a.name || ""),
        };
      });
    json(res, 200, { ads: list });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { getNotices, getAds };
