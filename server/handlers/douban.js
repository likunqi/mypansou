const { fetchHttps, json } = require("../middleware");

async function getDoubanHot() {
  var res = await fetchHttps("movie.douban.com", "/chart");
  if (res.status !== 200) return { error: "douban_fetch_failed", status: res.status };
  var items = [];
  var itemRegex = /<tr class="item">([\s\S]*?)<\/tr>/g;
  var match;
  while ((match = itemRegex.exec(res.body)) !== null) {
    var block = match[1];
    var titleMatch = block.match(/<a class="nbg"[^>]*title="([^"]+)"/);
    var linkMatch = block.match(/<a class="nbg"[^>]*href="([^"]+)"/);
    var imgMatch = block.match(/<img[^>]*src="([^"]+)"[^>]*width="75"/);
    var ratingMatch = block.match(/<span class="rating_num">([^<]+)<\/span>/);
    var plMatch = block.match(/<span class="pl">\(([^)]*)\)<\/span>/);
    var descMatch = block.match(/<p class="pl">([^<]*)<\/p>/);
    if (titleMatch && linkMatch) {
      var idMatch = linkMatch[1].match(/subject\/(\d+)/);
      items.push({
        id: idMatch ? idMatch[1] : "", title: titleMatch[1].trim(), url: linkMatch[1],
        cover: imgMatch ? imgMatch[1] : "", rating: ratingMatch ? ratingMatch[1] : "",
        actors: plMatch ? plMatch[1].trim() : "", desc: descMatch ? descMatch[1].trim() : "",
      });
    }
  }
  return { items: items, total: items.length };
}

async function handler(req, res) {
  try {
    var data = await getDoubanHot();
    json(res, data.error ? 502 : 200, data);
  } catch (e) {
    json(res, 502, { error: "douban_error", message: e.message });
  }
}

module.exports = { handler, getDoubanHot };
