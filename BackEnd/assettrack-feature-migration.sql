CREATE DATABASE IF NOT EXISTS assettrack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE assettrack;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS tag VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS serial_number VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS supplier VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS status ENUM('working', 'repair', 'retired') NOT NULL DEFAULT 'working',
  ADD COLUMN IF NOT EXISTS useful_life_years DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS salvage_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS created_by INT UNSIGNED NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_assets_tag (tag),
  ADD CONSTRAINT fk_assets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

UPDATE assets SET tag = tag_code WHERE tag IS NULL;
UPDATE assets SET purchase_price = purchase_cost WHERE purchase_price = 0 AND purchase_cost > 0;
UPDATE assets SET status = CASE condition_status WHEN 'under_repair' THEN 'repair' ELSE condition_status END;
UPDATE assets SET useful_life_years = 5 WHERE useful_life_years IS NULL OR useful_life_years <= 0;
UPDATE assets SET salvage_value = 0 WHERE salvage_value IS NULL OR salvage_value < 0;

CREATE TABLE IF NOT EXISTS location_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id INT UNSIGNED NOT NULL,
  location VARCHAR(160) NULL,
  assigned_to INT UNSIGNED NULL,
  changed_by INT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_location_history_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_location_history_user FOREIGN KEY (changed_by) REFERENCES users(id),
  CONSTRAINT fk_location_history_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_location_history_asset (asset_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id INT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  details JSON NULL,
  actor INT UNSIGNED NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_log_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_log_actor FOREIGN KEY (actor) REFERENCES users(id),
  INDEX idx_audit_log_asset (asset_id, timestamp)
) ENGINE=InnoDB;

ALTER TABLE maintenance_records
  ADD COLUMN IF NOT EXISTS assigned_to INT UNSIGNED NULL,
  ADD CONSTRAINT fk_maintenance_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

INSERT IGNORE INTO categories (name) VALUES ('Laptop'), ('Forklift'), ('Printer');
