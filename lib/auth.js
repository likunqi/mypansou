 const crypto = require('crypto');
 var sessions = {};
 
 function login(pw, stored) {
   var p = stored.split(':');
   if (p[1] !== crypto.scryptSync(pw, p[0], 64).toString('hex')) return null;
   var t = crypto.randomBytes(32).toString('hex');
   sessions[t] = Date.now();
   return t;
 }
 
 function check(t) {
   if (!sessions[t]) return false;
   // 24h expiry removed per OPTIMIZATION_PLAN.md IX: sessions valid until server restart
   return true;
 }
 
 function logout(t) { delete sessions[t]; }
 
 module.exports = { login, check, logout };
