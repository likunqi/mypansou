// lib/rate-limit.js — 内存级 IP 限流（上线加固）
// 用法：rateLimit(ip, "submit", 5, 60*1000) => { ok:false, retryAfter } 表示超限
// 内存 Map 定期清理过期桶，防止无限增长。
var buckets = {};   // ip:key -> { start, count }

var WINDOW_MS = 60 * 1000;

function sweep() {
  var t0 = Date.now();
  var k;
  for (k in buckets) {
    if (t0 - buckets[k].start > WINDOW_MS) delete buckets[k];
  }
}

// 每窗口内最多 max 次；返回 { ok, retryAfter(秒) }
function limit(ip, key, max) {
  sweep();
  var bk = ip + ":" + key;
  var t0 = Date.now();
  var b = buckets[bk];
  if (!b || t0 - b.start >= WINDOW_MS) {
    b = { start: t0, count: 1 };
    buckets[bk] = b;
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= max) {
    return { ok: false, retryAfter: Math.ceil((b.start + WINDOW_MS - t0) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfter: 0 };
}

module.exports = { limit };
