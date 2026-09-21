CREATE DATABASE IF NOT EXISTS assettrack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE assettrack;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS locations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'staff',
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_auth_sessions_user (user_id), INDEX idx_auth_sessions_expiry (expires_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS assets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag VARCHAR(60) UNIQUE,
  tag_code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  category_id INT UNSIGNED NOT NULL,
  serial_number VARCHAR(160),
  location_id INT UNSIGNED,
  assigned_to INT UNSIGNED,
  condition_status ENUM('working', 'under_repair', 'retired') NOT NULL DEFAULT 'working',
  status ENUM('working', 'repair', 'retired') NOT NULL DEFAULT 'working',
  purchase_date DATE,
  purchase_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  current_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  supplier VARCHAR(160),
  useful_life_years DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  salvage_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT UNSIGNED,
  CONSTRAINT fk_assets_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_assets_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_assets_values CHECK (purchase_cost >= 0 AND current_value >= 0),
  INDEX idx_assets_status (condition_status), INDEX idx_assets_category (category_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS maintenance_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id INT UNSIGNED NOT NULL,
  task VARCHAR(255) NOT NULL,
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  status ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
  approved_by INT UNSIGNED,
  notes TEXT,
  assigned_to INT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_maintenance_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_maintenance_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_maintenance_date (scheduled_date), INDEX idx_maintenance_status (status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INT UNSIGNED,
  action VARCHAR(80) NOT NULL,
  details JSON,
  actor INT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at), INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS location_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id INT UNSIGNED NOT NULL,
  location VARCHAR(160),
  assigned_to INT UNSIGNED,
  changed_by INT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_location_history_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_location_history_user FOREIGN KEY (changed_by) REFERENCES users(id),
  CONSTRAINT fk_location_history_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_location_history_asset (asset_id, changed_at)
) ENGINE=InnoDB;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
UPDATE users SET approval_status = 'approved' WHERE approval_status IS NULL;
UPDATE users SET is_active = 1 WHERE is_active IS NULL;

ALTER TABLE maintenance_records
  ADD COLUMN IF NOT EXISTS approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by INT UNSIGNED NULL;

INSERT IGNORE INTO categories (name) VALUES ('Computer Equipment'), ('Office Furniture'), ('Vehicles'), ('Tools'), ('Other');
INSERT IGNORE INTO categories (name) VALUES ('Laptop'), ('Forklift'), ('Printer');
INSERT IGNORE INTO locations (name) VALUES ('Main Office'), ('Warehouse'), ('Field Office'), ('In Transit');