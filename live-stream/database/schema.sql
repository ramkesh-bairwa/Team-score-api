-- Live streaming schema (MySQL 8+).
-- Apply with `npm run db:migrate`, which creates DATABASE_NAME if needed and runs this file.
-- All timestamps are stored in UTC (the app sets time_zone = '+00:00' per connection).

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS live_rooms (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id        VARCHAR(32) NOT NULL,
  title          VARCHAR(150) NOT NULL,
  description    TEXT NULL,
  broadcaster_id INT UNSIGNED NOT NULL,
  external_ref   VARCHAR(64) NULL,          -- e.g. "cricscore:<match code>" for rooms created by CricScore
  status         ENUM('WAITING', 'LIVE', 'ENDED') NOT NULL DEFAULT 'WAITING',
  started_at     DATETIME NULL,
  ended_at       DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_live_rooms_room_id (room_id),
  KEY idx_live_rooms_broadcaster (broadcaster_id, created_at),
  KEY idx_live_rooms_status (status, started_at),
  KEY idx_live_rooms_external_ref (external_ref, status),
  CONSTRAINT fk_live_rooms_broadcaster
    FOREIGN KEY (broadcaster_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS viewer_sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  live_room_id INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED NULL,          -- NULL for anonymous viewers
  socket_id    VARCHAR(64) NOT NULL,
  joined_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at      DATETIME NULL,               -- NULL while the viewer is still watching
  PRIMARY KEY (id),
  KEY idx_viewer_sessions_room_active (live_room_id, left_at),
  KEY idx_viewer_sessions_user (user_id),
  KEY idx_viewer_sessions_socket (socket_id),
  CONSTRAINT fk_viewer_sessions_room
    FOREIGN KEY (live_room_id) REFERENCES live_rooms (id) ON DELETE CASCADE,
  CONSTRAINT fk_viewer_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One row per continuous recording segment (a page reload while live starts a new segment)
CREATE TABLE IF NOT EXISTS recordings (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  live_room_id     INT UNSIGNED NOT NULL,
  segment          SMALLINT UNSIGNED NOT NULL,
  file_name        VARCHAR(255) NOT NULL,
  mime_type        VARCHAR(100) NOT NULL,
  size_bytes       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  chunks_received  INT UNSIGNED NOT NULL DEFAULT 0,
  status           ENUM('RECORDING', 'READY', 'UPLOADING', 'UPLOADED', 'FAILED') NOT NULL DEFAULT 'RECORDING',
  youtube_video_id VARCHAR(32) NULL,
  upload_progress  TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- percent
  upload_error     VARCHAR(500) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recordings_room_segment (live_room_id, segment),
  KEY idx_recordings_status (status),
  CONSTRAINT fk_recordings_room
    FOREIGN KEY (live_room_id) REFERENCES live_rooms (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- A user's connected YouTube channel. The refresh token is AES-256-GCM encrypted with a key derived from SESSION_SECRET.
CREATE TABLE IF NOT EXISTS youtube_accounts (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           INT UNSIGNED NOT NULL,
  channel_id        VARCHAR(64) NOT NULL,
  channel_title     VARCHAR(255) NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_youtube_accounts_user (user_id),
  CONSTRAINT fk_youtube_accounts_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
