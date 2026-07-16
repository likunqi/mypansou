const fs = require("fs");
const path = require("path");
const nodeCrypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PANSOU_BASE = "so.252035.xyz";
const CFG = path.join(DATA_DIR, "config.json");
const ADMIN = path.join(DATA_DIR, "admin.json");
const COOKIES = path.join(DATA_DIR, "cookies.enc");
const CACHE = path.join(DATA_DIR, "cache.json");

function rd(p, d) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } }
function wr(p, d) { try { var dir = path.dirname(p); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf8"); } catch (e) {} }

function initData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(CFG)) wr(CFG, { pansouBase: "so.252035.xyz", encKey: nodeCrypto.randomBytes(32).toString("hex") });
  if (!fs.existsSync(ADMIN)) wr(ADMIN, { password: require("./crypto").hash("admin123"), created: Date.now() });
  if (!fs.existsSync(CACHE)) wr(CACHE, { links: {}, stats: { total: 0, quark: 0, baidu: 0 } });
}

module.exports = { rd, wr, initData, PANSOU_BASE, PATHS: { DATA_DIR, PUBLIC_DIR, CFG, ADMIN, COOKIES, CACHE } };
