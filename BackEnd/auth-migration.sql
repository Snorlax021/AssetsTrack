USE assettrack;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL;

UPDATE users SET full_name = COALESCE(full_name, name) WHERE full_name IS NULL;
ALTER TABLE users MODIFY role VARCHAR(40) NOT NULL DEFAULT 'staff';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_auth_sessions_user (user_id),
  INDEX idx_auth_sessions_expiry (expires_at)
) ENGINE=InnoDB;
