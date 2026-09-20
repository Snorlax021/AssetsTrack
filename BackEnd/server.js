const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);
const validConditions = new Set(['working', 'under_repair', 'retired']);
const validMaintenanceStatuses = new Set(['scheduled', 'in_progress', 'completed', 'cancelled']);
const validRoles = new Set(['admin', 'manager', 'staff', 'viewer']);
const auditRoles = ['admin', 'manager', 'viewer'];
const sessionHours = 8;
const categoryPrefixes = { laptop: 'LAP', forklift: 'FORK', printer: 'PRN', 'computer equipment': 'COMP', 'office furniture': 'FURN', vehicles: 'VEH', tools: 'TOOL', other: 'ASSET' };
const tagAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
app.use(cors()); app.use(express.json());

function asyncRoute(handler) { return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next); }
function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
function text(value, field, max) { const result = String(value ?? '').trim(); if (!result || result.length > max) throw error(`${field} is required and must be at most ${max} characters`); return result; }
function id(value, field) { if (value === undefined || value === null || value === '') return null; const result = Number(value); if (!Number.isInteger(result) || result < 1) throw error(`${field} must be a positive integer`); return result; }
function money(value, field) { const result = Number(value ?? 0); if (!Number.isFinite(result) || result < 0) throw error(`${field} must be a non-negative number`); return result; }
async function audit(connection, type, entityId, action, details) { await connection.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', [type, entityId, action, JSON.stringify(details || {})]); }
async function auditEvent(assetId, action, details, actor) { await pool.execute('INSERT INTO audit_log (asset_id, action, details, actor) VALUES (?, ?, ?, ?)', [assetId, action, JSON.stringify(details || {}), actor]); }
function email(value) { const result = String(value ?? '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || result.length > 190) throw error('A valid email is required'); return result; }
function password(value) { const result = String(value ?? ''); if (result.length < 8 || result.length > 128) throw error('Password must be between 8 and 128 characters'); return result; }
function hashPassword(value) { const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(value, salt, 64).toString('hex'); return `scrypt:${salt}:${hash}`; }
function verifyPassword(value, stored) { const [algorithm, salt, expected] = String(stored || '').split(':'); if (algorithm !== 'scrypt' || !salt || !expected) return false; const actual = crypto.scryptSync(value, salt, 64).toString('hex'); return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex')); }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function bearer(request) { const header = request.get('authorization') || ''; return header.startsWith('Bearer ') ? header.slice(7) : ''; }
async function authenticate(request, response, next) {
  try {
    const token = bearer(request); if (!token) throw error('Authentication required', 401);
    const [rows] = await pool.query(`SELECT s.id session_id, s.expires_at, u.id, u.full_name, u.email, u.role
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()`, [tokenHash(token)]);
    if (!rows[0]) throw error('Invalid or expired session', 401); request.user = rows[0]; request.sessionToken = token; next();
  } catch (err) { next(err); }
}
function optionalAuthenticate(request, response, next) { return bearer(request) ? authenticate(request, response, next) : next(); }
function requireRole(...roles) { return (request, response, next) => { if (!roles.includes(request.user.role)) return next(error('You do not have permission for this action', 403)); next(); }; }
function role(value) { const result = String(value || 'staff').trim().toLowerCase(); if (!validRoles.has(result)) throw error('Invalid role'); return result; }
function redactStaffAssets(rows, request) { return request.user.role === 'staff' ? rows.map(({ purchase_cost, current_value, ...asset }) => ({ ...asset, purchase_cost: null, current_value: null })) : rows; }
function assetStatus(value) { const result = String(value || 'working').trim().toLowerCase(); if (!['working', 'repair', 'retired'].includes(result)) throw error('Status must be working, repair, or retired'); return result; }
function dateValue(value, field) { const result = String(value || '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw error(`${field} must be a valid date`); return result; }
function randomTag(prefix) { let suffix = ''; for (let index = 0; index < 6; index += 1) suffix += tagAlphabet[crypto.randomInt(tagAlphabet.length)]; return `${prefix}-${suffix}`; }
async function uniqueTag(prefix, connection = pool) { for (let attempt = 0; attempt < 10; attempt += 1) { const tag = randomTag(prefix); const [rows] = await connection.query('SELECT id FROM assets WHERE tag = ? OR tag_code = ? LIMIT 1', [tag, tag]); if (!rows[0]) return tag; } throw error('Could not generate a unique asset tag', 503); }
async function categoryId(value, connection = pool) { const category = text(value, 'category', 80); const numericId = /^\d+$/.test(category) ? Number(category) : 0; const [rows] = await connection.execute('SELECT id, name FROM categories WHERE id = ? OR LOWER(name) = LOWER(?) LIMIT 1', [numericId, category]); if (!rows[0]) { const [result] = await connection.execute('INSERT INTO categories (name) VALUES (?)', [category]); return { id: result.insertId, name: category }; } return rows[0]; }
function depreciation(asset) { const purchasePrice = Number(asset.purchase_price ?? asset.purchase_cost ?? 0); const salvageValue = Number(asset.salvage_value ?? 0); const usefulLife = Number(asset.useful_life_years ?? 5); const purchaseDate = asset.purchase_date ? new Date(asset.purchase_date) : new Date(); const yearsElapsed = Number.isNaN(purchaseDate.getTime()) ? 0 : Math.max(0, (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)); const annual = usefulLife > 0 ? Math.max(0, (purchasePrice - salvageValue) / usefulLife) : 0; const current = Math.max(salvageValue, purchasePrice - annual * yearsElapsed); const schedule = Array.from({ length: Math.max(0, Math.ceil(usefulLife)) + 1 }, (_, year) => ({ year, book_value: Math.max(salvageValue, purchasePrice - annual * year) })); return { purchase_price: purchasePrice, salvage_value: salvageValue, useful_life_years: usefulLife, annual_depreciation: annual, years_elapsed: yearsElapsed, current_book_value: current, schedule }; }

app.get('/api/health', asyncRoute(async (request, response) => { await pool.query('SELECT 1'); response.json({ ok: true, database: 'connected' }); }));
app.post('/api/auth/register', optionalAuthenticate, asyncRoute(async (request, response) => {
  const fullName = text(request.body.full_name, 'full_name', 120); const userEmail = email(request.body.email); const userPassword = password(request.body.password);
  const requestedRole = role(request.body.role);
  const [[count]] = await pool.query('SELECT COUNT(*) total FROM users WHERE password_hash IS NOT NULL');
  if (Number(count.total) > 0 && !request.user) throw error('Only an admin can register users', 401);
  if (Number(count.total) > 0 && request.user.role !== 'admin') throw error('Only an admin can register users', 403);
  const role = Number(count.total) === 0 ? 'admin' : requestedRole;
  const [result] = await pool.execute('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)', [fullName, userEmail, hashPassword(userPassword), role]);
  response.status(201).json({ id: result.insertId, full_name: fullName, email: userEmail, role });
}));
app.get('/api/users', authenticate, requireRole('admin'), asyncRoute(async (request, response) => {
  const [rows] = await pool.query('SELECT id, full_name, email, role, created_at FROM users ORDER BY full_name'); response.json(rows);
}));
app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const userEmail = email(request.body.email); const userPassword = password(request.body.password);
  const [rows] = await pool.query('SELECT id, full_name, email, password_hash, role FROM users WHERE email = ?', [userEmail]);
  if (!rows[0] || !verifyPassword(userPassword, rows[0].password_hash)) throw error('Invalid email or password', 401);
  const token = crypto.randomBytes(32).toString('hex'); const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
  await pool.execute('INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [rows[0].id, tokenHash(token), expiresAt]);
  response.json({ token, expires_at: expiresAt.toISOString(), user: { id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email, role: rows[0].role } });
}));
app.use('/api/auth', authenticate);
app.get('/api/auth/me', (request, response) => response.json({ id: request.user.id, full_name: request.user.full_name, email: request.user.email, role: request.user.role }));
app.post('/api/auth/logout', asyncRoute(async (request, response) => { await pool.execute('UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = ?', [tokenHash(request.sessionToken)]); response.status(204).end(); }));
app.use('/api', authenticate);
app.get('/api/options', asyncRoute(async (request, response) => {
  await pool.query("INSERT IGNORE INTO categories (name) VALUES ('Computer Equipment'), ('Office Furniture'), ('Vehicles'), ('Tools'), ('Other')");
  await pool.query("INSERT IGNORE INTO locations (name) VALUES ('Main Office'), ('Warehouse'), ('Field Office'), ('In Transit')");
  const [categories] = await pool.query('SELECT id, name FROM categories ORDER BY name');
  const [locations] = await pool.query('SELECT id, name FROM locations ORDER BY name');
  const [users] = await pool.query("SELECT id, full_name name, role FROM users WHERE role IN ('staff', 'manager') ORDER BY full_name");
  response.json({ categories, locations, users });
}));
app.get('/api/dashboard', asyncRoute(async (request, response) => {
  const [[summary]] = await pool.query(`SELECT COUNT(*) total_assets, COALESCE(SUM(condition_status = 'working'), 0) working,
      COALESCE(SUM(condition_status = 'under_repair'), 0) under_repair, COALESCE(SUM(condition_status = 'retired'), 0) retired,
    COALESCE(SUM(current_value), 0) book_value FROM assets`);
  const [[due]] = await pool.query("SELECT COUNT(*) maintenance_due FROM maintenance_records WHERE status IN ('scheduled', 'in_progress') AND scheduled_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)");
  const [recentActivity] = await pool.query('SELECT id, entity_type, entity_id, action, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 8');
  const [upcomingMaintenance] = await pool.query("SELECT m.id, a.tag_code, a.name asset_name, m.task, m.scheduled_date, m.status FROM maintenance_records m JOIN assets a ON a.id = m.asset_id WHERE m.status IN ('scheduled', 'in_progress') ORDER BY m.scheduled_date LIMIT 8");
  response.json({ summary: { ...summary, ...due, book_value: request.user.role === 'staff' ? null : summary.book_value }, recentActivity: request.user.role === 'staff' ? [] : recentActivity, upcomingMaintenance, permissions: { canSeeFinancials: request.user.role !== 'staff', canSeeAudit: auditRoles.includes(request.user.role), canApprove: ['admin', 'manager'].includes(request.user.role), canWrite: ['admin', 'staff'].includes(request.user.role) } });
}));

  const enhancedAssetSelect = `SELECT a.*, c.name category, c.name category_name, l.name location_name, u.full_name assigned_name,
    COALESCE(a.status, CASE a.condition_status WHEN 'under_repair' THEN 'repair' ELSE a.condition_status END) status
    FROM assets a JOIN categories c ON c.id = a.category_id LEFT JOIN locations l ON l.id = a.location_id LEFT JOIN users u ON u.id = a.assigned_to`;

  app.get('/api/assets', asyncRoute(async (request, response) => { const [rows] = await pool.query(`${enhancedAssetSelect} ORDER BY a.created_at DESC`); response.json(redactStaffAssets(rows, request)); }));
  app.get('/api/assets/:id(\\d+)', asyncRoute(async (request, response) => { const assetId = id(request.params.id, 'id'); const [rows] = await pool.query(`${enhancedAssetSelect} WHERE a.id = ?`, [assetId]); if (!rows[0]) throw error('Asset not found', 404); response.json(redactStaffAssets(rows, request)[0]); }));
  app.post('/api/assets', requireRole('admin'), asyncRoute(async (request, response) => {
    const body = request.body; const category = await categoryId(body.category_id || body.category); const categoryPrefix = categoryPrefixes[category.name.toLowerCase()] || category.name.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'ASSET';
    const name = text(body.name, 'name', 160); const purchasePrice = money(body.purchase_price ?? body.purchase_cost, 'purchase_price'); const salvageValue = money(body.salvage_value, 'salvage_value'); const usefulLife = Number(body.useful_life_years ?? 5); if (!Number.isFinite(usefulLife) || usefulLife <= 0 || usefulLife > 100) throw error('useful_life_years must be between 0 and 100');
    const locationId = id(body.location_id, 'location_id'); const assignedTo = id(body.assigned_to, 'assigned_to'); const status = assetStatus(body.status || body.condition_status); const purchaseDate = body.purchase_date ? dateValue(body.purchase_date, 'purchase_date') : null; const connection = await pool.getConnection();
    try { await connection.beginTransaction(); const tag = await uniqueTag(categoryPrefix, connection); const [result] = await connection.execute(`INSERT INTO assets (tag, tag_code, name, description, category_id, serial_number, purchase_date, purchase_cost, purchase_price, supplier, location_id, assigned_to, condition_status, status, useful_life_years, salvage_value, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tag, tag, name, body.description || null, category.id, body.serial_number || null, purchaseDate, purchasePrice, purchasePrice, body.supplier || null, locationId, assignedTo, status === 'repair' ? 'under_repair' : status, status, usefulLife, salvageValue, request.user.id]); await connection.execute('INSERT INTO location_history (asset_id, location, assigned_to, changed_by) VALUES (?, ?, ?, ?)', [result.insertId, body.location || null, assignedTo, request.user.id]); await connection.commit(); await auditEvent(result.insertId, 'registered', { tag, name }, request.user.id); const [rows] = await pool.query(`${enhancedAssetSelect} WHERE a.id = ?`, [result.insertId]); response.status(201).json({ ...rows[0], qr_value: `ASSETTRACK:${tag}`, qr_code: await QRCode.toDataURL(`ASSETTRACK:${tag}`) }); } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
  }));
  app.get('/api/assets/:id/qr', asyncRoute(async (request, response) => { const assetId = id(request.params.id, 'id'); const [[asset]] = await pool.query('SELECT tag FROM assets WHERE id = ?', [assetId]); if (!asset) throw error('Asset not found', 404); response.type('image/png').send(await QRCode.toBuffer(`ASSETTRACK:${asset.tag}`)); }));
  app.patch('/api/assets/:id/location', requireRole('admin', 'staff'), asyncRoute(async (request, response) => { const assetId = id(request.params.id, 'id'); const locationId = id(request.body.location_id, 'location_id'); const assignedTo = id(request.body.assigned_to, 'assigned_to'); const location = request.body.location ? text(request.body.location, 'location', 160) : null; const connection = await pool.getConnection(); try { await connection.beginTransaction(); const [result] = await connection.execute('UPDATE assets SET location_id = ?, assigned_to = ? WHERE id = ?', [locationId, assignedTo, assetId]); if (!result.affectedRows) throw error('Asset not found', 404); await connection.execute('INSERT INTO location_history (asset_id, location, assigned_to, changed_by) VALUES (?, ?, ?, ?)', [assetId, location, assignedTo, request.user.id]); await connection.commit(); await auditEvent(assetId, 'location_changed', { location, assigned_to: assignedTo }, request.user.id); response.json({ ok: true }); } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); } }));
  app.get('/api/assets/:id/history', asyncRoute(async (request, response) => { const assetId = id(request.params.id, 'id'); const [rows] = await pool.query('SELECT h.*, u.full_name changed_by_name, a.full_name assigned_name FROM location_history h JOIN users u ON u.id = h.changed_by LEFT JOIN users a ON a.id = h.assigned_to WHERE h.asset_id = ? ORDER BY h.changed_at ASC', [assetId]); response.json(rows); }));
  app.patch('/api/assets/:id/status', requireRole('admin', 'staff'), asyncRoute(async (request, response) => { const assetId = id(request.params.id, 'id'); const status = assetStatus(request.body.status); if (status === 'retired' && request.user.role !== 'admin') throw error('Only an admin can retire an asset', 403); const [result] = await pool.execute("UPDATE assets SET status = ?, condition_status = CASE ? WHEN 'repair' THEN 'under_repair' ELSE ? END WHERE id = ?", [status, status, status, assetId]); if (!result.affectedRows) throw error('Asset not found', 404); await auditEvent(assetId, 'status_changed', { status }, request.user.id); response.json({ ok: true, status }); }));
  app.get('/api/assets/:id/depreciation', asyncRoute(async (request, response) => { const assetId = id(request.params.id, 'id'); const [[asset]] = await pool.query('SELECT * FROM assets WHERE id = ?', [assetId]); if (!asset) throw error('Asset not found', 404); response.json(depreciation(asset)); }));

  app.get('/api/reports/summary', asyncRoute(async (request, response) => { const [[status]] = await pool.query("SELECT SUM(status = 'working') working, SUM(status = 'repair') repair, SUM(status = 'retired') retired, COUNT(*) total_assets FROM assets"); const [[value]] = await pool.query('SELECT COALESCE(SUM(GREATEST(salvage_value, purchase_price - ((purchase_price - salvage_value) / NULLIF(useful_life_years, 0)) * GREATEST(0, DATEDIFF(CURDATE(), purchase_date) / 365.25))), 0) total_book_value FROM assets'); const [[maintenance]] = await pool.query("SELECT SUM(status = 'scheduled' AND scheduled_date < CURDATE()) overdue, SUM(status = 'scheduled' AND scheduled_date >= CURDATE() AND scheduled_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) due_soon, SUM(status = 'completed') completed FROM maintenance_records"); const [categories] = await pool.query('SELECT c.name category, COUNT(*) count FROM assets a JOIN categories c ON c.id = a.category_id GROUP BY c.id, c.name ORDER BY count DESC'); const [locations] = await pool.query("SELECT COALESCE(l.name, 'Unassigned') location, COUNT(*) count FROM assets a LEFT JOIN locations l ON l.id = a.location_id GROUP BY l.id, l.name ORDER BY count DESC"); response.json({ status, total_book_value: value.total_book_value, maintenance, categories, locations }); }));

  app.get('/api/maintenance', asyncRoute(async (request, response) => { const filter = request.query.filter; const conditions = filter === 'completed' ? "m.status = 'completed'" : filter === 'overdue' ? "m.status = 'scheduled' AND m.scheduled_date < CURDATE()" : filter === 'upcoming' ? "m.status = 'scheduled' AND m.scheduled_date >= CURDATE()" : '1=1'; const [rows] = await pool.query(`SELECT m.*, a.tag_code tag, a.name asset_name, u.full_name assigned_name FROM maintenance_records m JOIN assets a ON a.id = m.asset_id LEFT JOIN users u ON u.id = m.assigned_to WHERE ${conditions} ORDER BY m.scheduled_date`); response.json(rows); }));
  app.post('/api/maintenance', requireRole('admin'), asyncRoute(async (request, response) => { const assetId = id(request.body.asset_id, 'asset_id'); const title = text(request.body.title || request.body.task, 'title', 255); const scheduledDate = dateValue(request.body.scheduled_date, 'scheduled_date'); const assignedTo = id(request.body.assigned_to, 'assigned_to'); const [result] = await pool.execute('INSERT INTO maintenance_records (asset_id, task, scheduled_date, assigned_to, status) VALUES (?, ?, ?, ?, \'scheduled\')', [assetId, title, scheduledDate, assignedTo]); await auditEvent(assetId, 'maintenance_scheduled', { maintenance_id: result.insertId, title }, request.user.id); const [rows] = await pool.query('SELECT m.*, a.tag_code tag, a.name asset_name FROM maintenance_records m JOIN assets a ON a.id = m.asset_id WHERE m.id = ?', [result.insertId]); response.status(201).json(rows[0]); }));
  app.patch('/api/maintenance/:id/complete', requireRole('admin', 'staff'), asyncRoute(async (request, response) => { const maintenanceId = id(request.params.id, 'id'); const [rows] = await pool.query('SELECT asset_id FROM maintenance_records WHERE id = ?', [maintenanceId]); if (!rows[0]) throw error('Maintenance record not found', 404); const [result] = await pool.execute("UPDATE maintenance_records SET status = 'completed', completed_date = CURDATE() WHERE id = ?", [maintenanceId]); if (!result.affectedRows) throw error('Maintenance record not found', 404); await auditEvent(rows[0].asset_id, 'maintenance_completed', { maintenance_id: maintenanceId }, request.user.id); response.json({ ok: true }); }));
const assetSelect = `SELECT a.*, c.name category_name, l.name location_name, u.full_name assigned_name FROM assets a
  JOIN categories c ON c.id = a.category_id LEFT JOIN locations l ON l.id = a.location_id LEFT JOIN users u ON u.id = a.assigned_to`;
app.get('/api/assets', asyncRoute(async (request, response) => { const [rows] = await pool.query(`${assetSelect} ORDER BY a.created_at DESC`); response.json(redactStaffAssets(rows, request)); }));
function assetPayload(body) {
  const condition = body.condition_status || 'working'; if (!validConditions.has(condition)) throw error('Invalid asset condition');
  return [text(body.tag_code, 'tag_code', 60), text(body.name, 'name', 160), body.description || null, id(body.category_id, 'category_id'), id(body.location_id, 'location_id'), id(body.assigned_to, 'assigned_to'), condition, body.purchase_date || null, money(body.purchase_cost, 'purchase_cost'), money(body.current_value, 'current_value')];
}
app.post('/api/assets', requireRole('admin'), asyncRoute(async (request, response) => {
  const values = assetPayload(request.body); if (!values[3]) throw error('category_id is required'); const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const [result] = await connection.execute('INSERT INTO assets (tag_code, name, description, category_id, location_id, assigned_to, condition_status, purchase_date, purchase_cost, current_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values); await audit(connection, 'asset', result.insertId, 'created', { tag_code: values[0], name: values[1] }); await connection.commit(); const [rows] = await pool.query(`${assetSelect} WHERE a.id = ?`, [result.insertId]); response.status(201).json(rows[0]); } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
}));
app.put('/api/assets/:id', requireRole('admin', 'staff'), asyncRoute(async (request, response) => {
  if (request.user.role === 'staff') {
    const assetId = id(request.params.id, 'id'); const condition = request.body.condition_status || 'working';
    if (!validConditions.has(condition)) throw error('Invalid asset condition');
    if (condition === 'retired') throw error('Retirement requires manager or admin approval', 403);
    const locationId = id(request.body.location_id, 'location_id'); const assignedTo = id(request.body.assigned_to, 'assigned_to');
    const [result] = await pool.execute('UPDATE assets SET location_id=?, assigned_to=?, condition_status=? WHERE id=?', [locationId, assignedTo, condition, assetId]);
    if (!result.affectedRows) throw error('Asset not found', 404);
    await pool.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', ['asset', assetId, 'updated', JSON.stringify({ location_id: locationId, condition_status: condition })]);
    const [rows] = await pool.query(`${assetSelect} WHERE a.id = ?`, [assetId]); response.json(redactStaffAssets(rows, request)); return;
  }
  const assetId = id(request.params.id, 'id'); const values = assetPayload(request.body); if (!values[3]) throw error('category_id is required'); const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const [result] = await connection.execute('UPDATE assets SET tag_code=?, name=?, description=?, category_id=?, location_id=?, assigned_to=?, condition_status=?, purchase_date=?, purchase_cost=?, current_value=? WHERE id=?', [...values, assetId]); if (!result.affectedRows) throw error('Asset not found', 404); await audit(connection, 'asset', assetId, 'updated', { tag_code: values[0], name: values[1] }); await connection.commit(); const [rows] = await pool.query(`${assetSelect} WHERE a.id = ?`, [assetId]); response.json(rows[0]); } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
}));
app.post('/api/assets/:id/approve-retirement', requireRole('admin', 'manager'), asyncRoute(async (request, response) => {
  const assetId = id(request.params.id, 'id'); const [result] = await pool.execute("UPDATE assets SET condition_status='retired' WHERE id=?", [assetId]);
  if (!result.affectedRows) throw error('Asset not found', 404);
  await pool.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', ['asset', assetId, 'retirement_approved', JSON.stringify({ approved_by: request.user.role })]);
  response.status(204).end();
}));
app.delete('/api/assets/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const assetId = id(request.params.id, 'id'); const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const [rows] = await connection.execute('SELECT tag_code, name FROM assets WHERE id=?', [assetId]); if (!rows[0]) throw error('Asset not found', 404); await connection.execute('DELETE FROM assets WHERE id=?', [assetId]); await audit(connection, 'asset', assetId, 'deleted', rows[0]); await connection.commit(); response.status(204).end(); } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
}));

app.get('/api/maintenance', asyncRoute(async (request, response) => { const [rows] = await pool.query('SELECT m.*, a.tag_code, a.name asset_name FROM maintenance_records m JOIN assets a ON a.id=m.asset_id ORDER BY m.scheduled_date DESC'); response.json(rows); }));
function maintenancePayload(body) { const status = body.status || 'scheduled'; if (!validMaintenanceStatuses.has(status)) throw error('Invalid maintenance status'); return [id(body.asset_id, 'asset_id'), text(body.task, 'task', 255), text(body.scheduled_date, 'scheduled_date', 10), body.completed_date || null, status, body.notes || null]; }
app.post('/api/maintenance', requireRole('admin'), asyncRoute(async (request, response) => { const values = maintenancePayload(request.body); if (!values[0]) throw error('asset_id is required'); const [result] = await pool.execute('INSERT INTO maintenance_records (asset_id, task, scheduled_date, completed_date, status, notes) VALUES (?, ?, ?, ?, ?, ?)', values); await pool.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', ['maintenance', result.insertId, 'created', JSON.stringify({ task: values[1] })]); const [rows] = await pool.query('SELECT m.*, a.tag_code, a.name asset_name FROM maintenance_records m JOIN assets a ON a.id=m.asset_id WHERE m.id=?', [result.insertId]); response.status(201).json(rows[0]); }));
app.post('/api/maintenance/:id/complete', requireRole('admin', 'staff'), asyncRoute(async (request, response) => {
  const maintenanceId = id(request.params.id, 'id'); const completedDate = request.body.completed_date || new Date().toISOString().slice(0, 10); const notes = request.body.notes ? String(request.body.notes).trim().slice(0, 2000) : null;
  const [result] = await pool.execute("UPDATE maintenance_records SET status='completed', completed_date=?, notes=COALESCE(?, notes) WHERE id=?", [completedDate, notes, maintenanceId]);
  if (!result.affectedRows) throw error('Maintenance record not found', 404);
  await pool.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', ['maintenance', maintenanceId, 'completed', JSON.stringify({ completed_by: request.user.role })]); response.status(204).end();
}));
app.put('/api/maintenance/:id', requireRole('admin'), asyncRoute(async (request, response) => { const maintenanceId = id(request.params.id, 'id'); const values = maintenancePayload(request.body); if (!values[0]) throw error('asset_id is required'); const [result] = await pool.execute('UPDATE maintenance_records SET asset_id=?, task=?, scheduled_date=?, completed_date=?, status=?, notes=? WHERE id=?', [...values, maintenanceId]); if (!result.affectedRows) throw error('Maintenance record not found', 404); await pool.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', ['maintenance', maintenanceId, 'updated', JSON.stringify({ task: values[1] })]); response.json({ id: maintenanceId, ...request.body }); }));
app.delete('/api/maintenance/:id', requireRole('admin'), asyncRoute(async (request, response) => { const maintenanceId = id(request.params.id, 'id'); const [result] = await pool.execute('DELETE FROM maintenance_records WHERE id=?', [maintenanceId]); if (!result.affectedRows) throw error('Maintenance record not found', 404); await pool.execute('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', ['maintenance', maintenanceId, 'deleted', JSON.stringify({})]); response.status(204).end(); }));
app.get('/api/audit', requireRole(...auditRoles), asyncRoute(async (request, response) => { const [rows] = await pool.query('SELECT id, entity_type, entity_id, action, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100'); response.json(rows); }));

app.use(express.static(path.join(__dirname, '..', 'FrontEnd')));
app.use((err, request, response, next) => { console.error(err); const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : err.code === 'ER_NO_REFERENCED_ROW_2' ? 400 : 500); response.status(status).json({ error: status === 500 ? 'Unexpected server error' : err.message }); });
app.listen(port, () => console.log(`AssetTrack running at http://localhost:${port}`));