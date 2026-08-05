-- 云盘搜 v2.1 MySQL 建库脚本（修正版：修复了原文件的断句 INSERT 与乱码注释）
-- 实际 16 张表：站点配置 / 管理员 / Cookie / 转存缓存 / 转存历史 / 核心资源 / 用户提交 /
--   采集源 / 采集规则 / 导入日志 / 失效反馈 / 热搜词 / 定时任务 / 任务日志 / 自定义脚本 / 分类

-- 1. 站点配置（替代 config.json）
CREATE TABLE IF NOT EXISTS site_config (
  config_key   VARCHAR(64)  PRIMARY KEY,
  config_value TEXT         NOT NULL,
  description  VARCHAR(256) DEFAULT "",
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 管理员（替代 admin.json）
CREATE TABLE IF NOT EXISTS admin_users (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(32)  NOT NULL DEFAULT "admin",
  password_hash VARCHAR(256) NOT NULL,
  role          VARCHAR(16)  DEFAULT "admin",
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 网盘 Cookie（替代 cookies.enc）
CREATE TABLE IF NOT EXISTS cookies (
  provider        VARCHAR(16)  PRIMARY KEY,
  encrypted_value TEXT         NOT NULL,
  is_valid        TINYINT(1)   DEFAULT 0,
  last_tested_at  DATETIME     DEFAULT NULL,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. 转存缓存（替代 cache.json）
CREATE TABLE IF NOT EXISTS transfer_cache (
  id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
  original_url  VARCHAR(512) NOT NULL,
  new_url       TEXT         NOT NULL,
  pwd           VARCHAR(8)   DEFAULT "",
  note          VARCHAR(256) DEFAULT "",
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  expire_at     DATETIME     DEFAULT NULL,
  INDEX idx_url (original_url(128)),
  INDEX idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. 转存历史
CREATE TABLE IF NOT EXISTS transfer_history (
  id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
  original_url  VARCHAR(512) NOT NULL,
  new_url       TEXT         NOT NULL,
  pwd           VARCHAR(8)   DEFAULT "",
  type          VARCHAR(16)  NOT NULL,
  title         VARCHAR(256) DEFAULT "",
  success       TINYINT(1)   DEFAULT 1,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (type),
  INDEX idx_created (created_at DESC),
  INDEX idx_original_url (original_url(128))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. 核心资源表（本地搜索 / 入库三管道的目标表）
CREATE TABLE IF NOT EXISTS resources (
  id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
  title           VARCHAR(256) NOT NULL,
  url             VARCHAR(512) NOT NULL,
  password        VARCHAR(32)  DEFAULT "",
  disk_type       VARCHAR(16)  NOT NULL DEFAULT "quark",
  category        VARCHAR(64)  DEFAULT "",
  tags            VARCHAR(256) DEFAULT "",
  description     TEXT         DEFAULT NULL,
  file_name       VARCHAR(256) DEFAULT "",
  file_size       VARCHAR(32)  DEFAULT "",
  source          VARCHAR(16)  NOT NULL DEFAULT "manual",
  source_id       VARCHAR(64)  DEFAULT "",
  status          TINYINT(1)   DEFAULT 1,
  link_valid      TINYINT(1)   DEFAULT 0,
  check_message   VARCHAR(128) DEFAULT "",
  search_count    INT          DEFAULT 0,
  last_checked_at DATETIME     DEFAULT NULL,
  check_fail_count INT         DEFAULT 0,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_title (title(64)),
  INDEX idx_disk_type (disk_type),
  INDEX idx_category (category, status),
  INDEX idx_source (source, status),
  INDEX idx_created (created_at DESC),
  INDEX idx_url (url(128)),
  FULLTEXT INDEX ft_title_desc (title, description) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. 用户提交待审
CREATE TABLE IF NOT EXISTS submitted_resources (
  id                INT          PRIMARY KEY AUTO_INCREMENT,
  title             VARCHAR(256) NOT NULL,
  url               VARCHAR(512) NOT NULL,
  password          VARCHAR(32)  DEFAULT "",
  disk_type         VARCHAR(16)  DEFAULT "quark",
  description       TEXT         DEFAULT NULL,
  category          VARCHAR(64)  DEFAULT "",
  submitter_name    VARCHAR(64)  DEFAULT "",
  submitter_contact VARCHAR(128) DEFAULT "",
  status            TINYINT(1)   DEFAULT 0,
  admin_remark      VARCHAR(256) DEFAULT "",
  link_valid        TINYINT(1)   DEFAULT 0,
  check_message     VARCHAR(128) DEFAULT "",
  created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
  reviewed_at       DATETIME     DEFAULT NULL,
  resource_id       BIGINT       DEFAULT NULL,
  INDEX idx_status (status, created_at DESC),
  INDEX idx_category (category),
  INDEX idx_disk_type (disk_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. 采集源
CREATE TABLE IF NOT EXISTS crawler_sources (
  id              INT          PRIMARY KEY AUTO_INCREMENT,
  name            VARCHAR(128) NOT NULL,
  description     VARCHAR(256) DEFAULT "",
  source_type     VARCHAR(16)  NOT NULL,
  url_template    VARCHAR(512) NOT NULL,
  page_start      INT          DEFAULT 1,
  page_end        INT          DEFAULT 1,
  page_param      VARCHAR(32)  DEFAULT "/page/{page}",
  encoding        VARCHAR(16)  DEFAULT "utf-8",
  interval_mins   INT          DEFAULT 0,
  status          TINYINT(1)   DEFAULT 1,
  category        VARCHAR(64)  DEFAULT "",
  disk_type       VARCHAR(16)  DEFAULT "",
  use_proxy       TINYINT(1)   DEFAULT 0,
  last_crawled_at DATETIME     DEFAULT NULL,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_type (status, source_type),
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. 采集规则
CREATE TABLE IF NOT EXISTS crawler_rules (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  source_id     INT          NOT NULL,
  field_name    VARCHAR(32)  NOT NULL,
  rule_type     VARCHAR(16)  NOT NULL DEFAULT "css",
  rule_value    TEXT         NOT NULL,
  attr_name     VARCHAR(32)  DEFAULT "",
  filter_regex  VARCHAR(256) DEFAULT "",
  default_value VARCHAR(128) DEFAULT "",
  required      TINYINT(1)   DEFAULT 0,
  position      INT          DEFAULT 0,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source (source_id, position),
  INDEX idx_field (field_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. 导入日志
CREATE TABLE IF NOT EXISTS import_logs (
  id             BIGINT       PRIMARY KEY AUTO_INCREMENT,
  file_name      VARCHAR(256) NOT NULL,
  file_format    VARCHAR(16)  NOT NULL,
  total_rows     INT          DEFAULT 0,
  imported_rows  INT          DEFAULT 0,
  skipped_rows   INT          DEFAULT 0,
  duplicate_urls INT          DEFAULT 0,
  category       VARCHAR(64)  DEFAULT "",
  disk_type      VARCHAR(16)  DEFAULT "",
  status         VARCHAR(16)  NOT NULL DEFAULT "completed",
  error_msg      TEXT         DEFAULT NULL,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. 失效反馈记录
CREATE TABLE IF NOT EXISTS broken_link_reports (
  id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
  resource_id   BIGINT       NOT NULL,
  reporter_ip   VARCHAR(64)  DEFAULT "",
  reporter_name VARCHAR(64)  DEFAULT "",
  message       VARCHAR(256) DEFAULT "",
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resource (resource_id, created_at DESC),
  INDEX idx_ip (reporter_ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 12. 热搜关键词
CREATE TABLE IF NOT EXISTS search_keywords (
  id           INT          PRIMARY KEY AUTO_INCREMENT,
  keyword      VARCHAR(128) NOT NULL,
  search_count INT          DEFAULT 1,
  is_hot       TINYINT(1)   DEFAULT 0,
  sort_order   INT          DEFAULT 0,
  source       VARCHAR(16)  DEFAULT "",
  status       TINYINT(1)   DEFAULT 1,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_keyword (keyword),
  INDEX idx_hot_sort (is_hot DESC, sort_order DESC, search_count DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 13. 定时任务
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  task_name     VARCHAR(64)  NOT NULL,
  task_type     VARCHAR(32)  NOT NULL,
  interval_sec  INT          NOT NULL DEFAULT 3600,
  task_config   JSON         DEFAULT NULL,
  status        TINYINT(1)   DEFAULT 1,
  last_run_at   DATETIME     DEFAULT NULL,
  next_run_at   DATETIME     DEFAULT NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_type_status (task_type, status),
  INDEX idx_next_run (next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 14. 任务执行日志
CREATE TABLE IF NOT EXISTS task_logs (
  id           BIGINT       PRIMARY KEY AUTO_INCREMENT,
  task_id      INT          NOT NULL,
  task_type    VARCHAR(32)  NOT NULL,
  status       VARCHAR(16)  NOT NULL,
  started_at   DATETIME     NOT NULL,
  finished_at  DATETIME     DEFAULT NULL,
  duration_ms  INT          DEFAULT 0,
  result_msg   TEXT         DEFAULT NULL,
  error_msg    TEXT         DEFAULT NULL,
  INDEX idx_task_id (task_id, started_at DESC),
  INDEX idx_type_time (task_type, started_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 15. 自定义 JS 脚本
CREATE TABLE IF NOT EXISTS custom_scripts (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  script_name VARCHAR(64)  NOT NULL,
  script_type VARCHAR(32)  NOT NULL DEFAULT "head",
  script_code TEXT         NOT NULL,
  position    INT          DEFAULT 0,
  enabled     TINYINT(1)   DEFAULT 1,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_type_enabled (script_type, enabled, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 16. 分类管理
CREATE TABLE IF NOT EXISTS categories (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL,
  sort_order  INT          DEFAULT 0,
  status      TINYINT(1)   DEFAULT 1,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 17. AI 提炼结果（后台 AI 提炼保存）
CREATE TABLE IF NOT EXISTS ai_summaries (
  id           INT          PRIMARY KEY AUTO_INCREMENT,
  scope        VARCHAR(32)  DEFAULT "",
  input_text   TEXT         DEFAULT NULL,
  output_text  MEDIUMTEXT   DEFAULT NULL,
  model        VARCHAR(64)  DEFAULT "",
  status       VARCHAR(16)  DEFAULT "ok",
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 初始数据 =====
INSERT IGNORE INTO categories (name, sort_order) VALUES
  ("电影", 1), ("电视剧", 2), ("短剧", 3), ("综艺", 4),
  ("动漫", 5), ("纪录片", 6), ("软件", 7), ("游戏", 8),
  ("音乐", 9), ("文档", 10), ("图片", 11), ("其他", 12);

INSERT IGNORE INTO admin_users (id, username, password_hash, role)
  VALUES (1, "admin", "", "admin");

INSERT IGNORE INTO site_config (config_key, config_value, description) VALUES
  ("pansouBase",           "so.252035.xyz",      "盘搜 API 地址"),
  ("quarkDir",             "0",                  "夸克转存目标目录 fid"),
  ("baiduDir",             "/",                  "百度转存目标目录路径"),
  ("shareUrlPrefix",       "",                   "分享链接前缀替换"),
  ("site_name",            "云盘搜",             "网站名称"),
  ("site_icon",            "",                   "网站图标 URL"),
  ("site_keywords",        "云盘搜索,夸克网盘,百度网盘", "SEO 关键词"),
  ("site_description",     "网盘资源搜索引擎",   "SEO 描述"),
  ("encKey",               "",                   "AES 加密密钥"),
  ("task_interval_cleanup", "86400",             "资源清理间隔(秒)"),
  ("task_interval_check",   "3600",              "链接检测间隔(秒)");

INSERT IGNORE INTO scheduled_tasks (task_name, task_type, interval_sec, task_config, status) VALUES
  ("转存资源清理", "cleanup", 86400, JSON_OBJECT("time", "03:00", "keep_days", 1), 1),
  ("链接可用性检测", "check_links", 3600,  JSON_OBJECT("batch_size", 50), 1),
  ("Cookie 状态刷新", "refresh_cookies", 43200, NULL, 1),
  ("豆瓣热词采集", "douban_hotwords", 86400, JSON_OBJECT("time", "08:00", "top", 10), 1);
