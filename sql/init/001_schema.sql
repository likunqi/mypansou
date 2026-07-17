-- ============================================================
-- 云盘搜 MySQL 建表脚本
-- 接入方式: docker compose mysql 启动时自动执行
-- 手动执行: mysql -uroot -pchangeme yunpansou < sql/init/001_schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS config (
  `key`   VARCHAR(64)  PRIMARY KEY,
  `value` TEXT         NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  password_hash VARCHAR(128) NOT NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cookies (
  provider        VARCHAR(16)  PRIMARY KEY,
  encrypted_value TEXT         NOT NULL COMMENT "iv:authTag:ciphertext",
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cache (
  id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
  cache_type VARCHAR(16)  NOT NULL COMMENT "link / search",
  cache_key  VARCHAR(512) NOT NULL COMMENT "URL 或搜索词 MD5",
  cache_val  JSON         NOT NULL,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  expire_at  DATETIME     DEFAULT NULL,
  INDEX idx_type_key (cache_type, cache_key(128)),
  INDEX idx_expire  (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transfer_history (
  id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
  original_url  TEXT         NOT NULL,
  new_url       TEXT         NOT NULL,
  pwd           VARCHAR(8)   DEFAULT "",
  `type`        VARCHAR(16)  NOT NULL COMMENT "quark / baidu",
  title         VARCHAR(256) DEFAULT "",
  success       TINYINT(1)   DEFAULT 1,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type  (`type`),
  INDEX idx_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认配置
INSERT IGNORE INTO config (`key`, `value`) VALUES
  ("pansouBase", "so.252035.xyz"),
  ("quarkDir", "0"),
  ("baiduDir", "/"),
  ("shareUrlPrefix", "");

-- 默认管理员密码: admin123（scrypt 哈希，与默认 JSON 一致时用）
-- 首次启动后手动插入或由应用迁移函数生成
