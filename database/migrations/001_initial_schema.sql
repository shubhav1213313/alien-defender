-- Alien Defender: initial schema
-- Run with: npm run db:migrate   (applies every migration once, in order)
-- Engine/charset: InnoDB for foreign keys and transactions, utf8mb4 for full Unicode.

-- Registered players. Passwords are stored ONLY as bcrypt hashes (60 chars).
CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(20)  NOT NULL,
  email         VARCHAR(254) NOT NULL,
  password_hash CHAR(60)     NOT NULL,
  role          ENUM('player', 'admin') NOT NULL DEFAULT 'player',
  avatar        VARCHAR(20)  NOT NULL DEFAULT 'falcon',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per game started by a logged-in player. The server records the
-- start time, so play duration cannot be faked by the browser.
CREATE TABLE game_sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NOT NULL,
  difficulty  ENUM('easy', 'normal', 'hard') NOT NULL,
  started_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_game_sessions_user (user_id, started_at),
  CONSTRAINT fk_game_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The final result of a game session (at most one per session).
CREATE TABLE scores (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_session_id   BIGINT UNSIGNED NOT NULL,
  user_id           INT UNSIGNED    NOT NULL,
  difficulty        ENUM('easy', 'normal', 'hard') NOT NULL,
  outcome           ENUM('victory', 'destroyed', 'earthFallen', 'abandoned') NOT NULL,
  score             INT UNSIGNED    NOT NULL,
  wave_reached      TINYINT UNSIGNED NOT NULL,
  enemies_destroyed SMALLINT UNSIGNED NOT NULL,
  max_combo         SMALLINT UNSIGNED NOT NULL,
  shots_fired       INT UNSIGNED    NOT NULL,
  shots_hit         INT UNSIGNED    NOT NULL,
  boss_defeated     BOOLEAN         NOT NULL DEFAULT FALSE,
  arena_correct     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  arena_questions   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  abilities_used    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  duration_seconds  INT UNSIGNED    NOT NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_scores_session (game_session_id),
  KEY idx_scores_leaderboard (difficulty, score),
  KEY idx_scores_user (user_id, created_at),
  CONSTRAINT fk_scores_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_scores_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_scores_arena CHECK (arena_correct <= arena_questions),
  CONSTRAINT chk_scores_hits CHECK (shots_hit <= shots_fired)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Knowledge Challenge Arena results, recorded BY THE SERVER when rewards are
-- claimed (the browser never reports its own quiz score).
CREATE TABLE quiz_attempts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED    NOT NULL,
  game_session_id BIGINT UNSIGNED NULL,
  wave            TINYINT UNSIGNED NOT NULL,
  difficulty      ENUM('easy', 'normal', 'hard') NOT NULL,
  correct         TINYINT UNSIGNED NOT NULL,
  total           TINYINT UNSIGNED NOT NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_quiz_user (user_id),
  KEY idx_quiz_session (game_session_id),
  CONSTRAINT fk_quiz_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_quiz_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE SET NULL,
  CONSTRAINT chk_quiz_correct CHECK (correct <= total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Achievement catalogue (static reference data).
CREATE TABLE achievements (
  id          VARCHAR(40)  NOT NULL,
  name        VARCHAR(60)  NOT NULL,
  description VARCHAR(200) NOT NULL,
  icon        VARCHAR(8)   NOT NULL,
  sort_order  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which player unlocked which achievement, and in which game.
CREATE TABLE user_achievements (
  user_id         INT UNSIGNED    NOT NULL,
  achievement_id  VARCHAR(40)     NOT NULL,
  game_session_id BIGINT UNSIGNED NULL,
  unlocked_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_id),
  CONSTRAINT fk_ua_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ua_achievement FOREIGN KEY (achievement_id) REFERENCES achievements (id),
  CONSTRAINT fk_ua_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side login sessions (used by express-mysql-session).
CREATE TABLE sessions (
  session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id),
  KEY idx_sessions_expires (expires)
) ENGINE=InnoDB;

INSERT INTO achievements (id, name, description, icon, sort_order) VALUES
  ('first_blood',        'First Blood',        'Destroy your first alien.',                                   '🎯', 1),
  ('alien_hunter',       'Alien Hunter',       'Destroy 250 aliens in total across all games.',               '👾', 2),
  ('wave_survivor',      'Wave Survivor',      'Clear all five waves in a single game.',                      '🌊', 3),
  ('boss_slayer',        'Boss Slayer',        'Destroy the Mothership.',                                     '🛸', 4),
  ('first_victory',      'First Victory',      'Win a game.',                                                 '🏆', 5),
  ('combo_master',       'Combo Master',       'Reach a 25-kill combo.',                                      '🔥', 6),
  ('perfect_quiz',       'Perfect Quiz',       'Score 4/4 in a Knowledge Challenge Arena.',                   '🧠', 7),
  ('knowledge_master',   'Knowledge Master',   'Answer 50 arena puzzles correctly in total.',                 '📚', 8),
  ('hard_victory',       'Hardened Defender',  'Win a game on Hard difficulty.',                              '💀', 9),
  ('legendary_defender', 'Legendary Defender', 'Score 4/4 on Hard in the post-boss Victory Bonus Challenge.', '👑', 10);
