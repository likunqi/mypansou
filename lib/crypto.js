 const crypto = require('crypto');
 
 function hash(pw) {
   var s = crypto.randomBytes(16).toString('hex');
   return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex');
 }
 
 function verify(pw, stored) {
   var p = stored.split(':');
   return p[1] === crypto.scryptSync(pw, p[0], 64).toString('hex');
 }
 
 function enc(text, key) {
   var iv = crypto.randomBytes(16);
   var c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
   var e = c.update(text, 'utf8', 'hex') + c.final('hex');
   return iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + e;
 }
 
 function dec(data, key) {
   var p = data.split(':');
   var d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(p[0], 'hex'));
   d.setAuthTag(Buffer.from(p[1], 'hex'));
   return d.update(p[2], 'hex', 'utf8') + d.final('utf8');
 }
 
 module.exports = { hash, verify, enc, dec };
