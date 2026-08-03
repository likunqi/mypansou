var fs = require('fs');
var sql = fs.readFileSync('sql/init/002_schema_v2.sql', 'utf8');

// 1. Add WITH PARSER ngram to fulltext index
sql = sql.replace(
  'FULLTEXT INDEX ft_title_desc (title, description)',
  'FULLTEXT INDEX ft_title_desc (title, description) WITH PARSER ngram'
);

// 2. Remove resource_categories line from site_config INSERT
var lines = sql.split('\n');
lines = lines.filter(function(line) {
  return line.indexOf('resource_categories') === -1;
});
sql = lines.join('\n');

// 3. Add categories table before the -- ===== preset data section
var presetIdx = sql.indexOf('-- =====');
var categoriesTable = "\n\n-- 15. \u5206\u7c7b\u7ba1\u7406\nCREATE TABLE IF NOT EXISTS categories (\n  id          INT          PRIMARY KEY AUTO_INCREMENT,\n  name        VARCHAR(64)  NOT NULL COMMENT \"\u5206\u7c7b\u540d\u79f0\",\n  sort_order  INT          DEFAULT 0 COMMENT \"\u6392\u5e8f\u6743\u91cd\",\n  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,\n  UNIQUE KEY uk_name (name)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\nINSERT IGNORE INTO categories (name, sort_order) VALUES\n  (\"\u7535\u5f71\", 1), (\"\u7535\u89c6\u5267\", 2), (\"\u77ed\u5267\", 3), (\"\u7efc\u827a\", 4),\n  (\"\u52a8\u6f2b\", 5), (\"\u7eaa\u5f55\u7247\", 6), (\"\u8f6f\u4ef6\", 7), (\"\u6e38\u620f\", 8),\n  (\"\u97f3\u4e50\", 9), (\"\u6587\u6863\", 10), (\"\u56fe\u7247\", 11), (\"\u5176\u4ed6\", 12);\n";
sql = sql.slice(0, presetIdx) + categoriesTable + sql.slice(presetIdx);

fs.writeFileSync('sql/init/002_schema_v2.sql', sql);
console.log('OK');