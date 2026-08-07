const crypto = require('crypto');
var sessions = {};   // token -> { at, ip }
var failMap = {};    // ip -> { count, firstAt, lockedUntil }

// 安全策略（上线加固）：
//  - token 7 天过期（原实现永不过期，泄露即永久后门）；
//  - 登录失败限流：10 分钟内同一 IP 失败 >=5 次，锁定 15 分钟；
//  - sessions/failMap 定期清理，防止内存无限增长。
const TOKEN_TTL = 7 * 24 * 3600 * 1000;   // 7 天
const FAIL_WINDOW = 10 * 60 * 1000;       // 10 分钟窗口
const FAIL_MAX = 5;                       // 窗口内允许失败次数
const LOCK_MS = 15 * 60 * 1000;           // 锁定 15 分钟

function now() { return Date.now(); }

function cleanupSessions() {
  var t0 = now();
  Object.keys(sessions).forEach(function (k) { if (t0 - sessions[k].at > TOKEN_TTL) delete sessions[k]; });
}

function cleanupFails() {
  var t0 = now();
  Object.keys(failMap).forEach(function (ip) {
    var f = failMap[ip];
    if (t0 - f.firstAt > FAIL_WINDOW) delete failMap[ip];
  });
}

// 获取当前登录锁状态：返回 0 表示可尝试，>0 表示剩余锁定秒数
function loginLocked(ip) {
  var f = failMap[ip];
  if (!f) return 0;
  if (f.lockedUntil && now() < f.lockedUntil) return Math.ceil((f.lockedUntil - now()) / 1000);
  if (f.lockedUntil && now() >= f.lockedUntil) { delete failMap[ip]; return 0; }
  return 0;
}

function recordFail(ip) {
  var t0 = now();
  var f = failMap[ip] || { count: 0, firstAt: t0, lockedUntil: 0 };
  if (t0 - f.firstAt > FAIL_WINDOW) { f = { count: 0, firstAt: t0, lockedUntil: 0 }; }
  f.count++;
  if (f.count >= FAIL_MAX) f.lockedUntil = t0 + LOCK_MS;
  failMap[ip] = f;
}

function login(pw, stored, ip) {
  cleanupSessions();
  var p = stored.split(':');
  if (p[1] !== crypto.scryptSync(pw, p[0], 64).toString('hex')) { recordFail(ip || "?"); return null; }
  var t = crypto.randomBytes(32).toString('hex');
  sessions[t] = { at: now(), ip: ip || "" };
  // 登录成功后清掉该 IP 的失败记录
  if (ip && failMap[ip]) delete failMap[ip];
  return t;
}

function check(t) {
  if (!sessions[t]) return false;
  if (now() - sessions[t].at > TOKEN_TTL) { delete sessions[t]; return false; }
  return true;
}

function logout(t) { delete sessions[t]; }

module.exports = { login, check, logout, loginLocked };
