// The frontend may run on Live Server (5500), while the API runs on Express (3000).
const api = 'http://localhost:3000/api';
const state = { assets: [], maintenance: [], options: { categories: [], locations: [], users: [] }, users: [], user: null, permissions: {} };
let token = localStorage.getItem('assetTrackToken');
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const dateText = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString() : '-';

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${api}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  } catch (networkError) {
    throw new Error('Cannot connect to the AssetTrack API. Start the backend with "npm install" and "npm start" from the BackEnd folder, then refresh this page.');
  }
  if (response.status === 401 && path !== '/auth/login') { token = null; localStorage.removeItem('assetTrackToken'); showLogin('Your session has expired. Please sign in again.'); }
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Request failed (${response.status})`); }
  return response.status === 204 ? null : response.json();
}

function showError(error) { window.alert(error.message); }
function showLogin(message = '') { $('#app').hidden = true; $('#login-screen').hidden = false; $('#login-error').textContent = message; $('#login-error').hidden = !message; }
const roleLabel = (role) => ({ admin: 'Admin', manager: 'Manager / Supervisor', staff: 'Staff / Encoder', viewer: 'Viewer / Auditor' }[role] || role);
function showApp(user) { state.user = user; $('#login-screen').hidden = true; $('#app').hidden = false; $('#current-user-name').textContent = user.full_name; $('#current-user-role').textContent = roleLabel(user.role); document.querySelectorAll('.admin-only').forEach((element) => { element.hidden = user.role !== 'admin'; }); document.querySelectorAll('.admin-edit-only').forEach((element) => { element.hidden = user.role !== 'admin'; }); document.querySelectorAll('.financial-only').forEach((element) => { element.hidden = user.role === 'staff'; }); document.querySelector('[data-page="audit"]').hidden = !['admin', 'manager', 'viewer'].includes(user.role); }
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function fillSelect(selector, items, emptyLabel, emptyState = 'No options found') {
  const select = $(selector);
  select.innerHTML = items.length
    ? `<option value="">${emptyLabel}</option>${items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}`
    : `<option value="" disabled selected>${emptyState}</option>`;
}

function renderAssets() {
  const query = ($('#asset-search').value || '').toLowerCase();
  const rows = state.assets.filter((asset) => `${asset.tag || asset.tag_code} ${asset.name}`.toLowerCase().includes(query));
  const actions = (asset) => `${state.user?.role === 'admin' ? `<button class="icon-button" data-edit-asset="${asset.id}">Edit</button><button class="icon-button danger" data-delete-asset="${asset.id}">Delete</button>` : state.user?.role === 'staff' ? `<button class="icon-button" data-edit-asset="${asset.id}">Update</button>` : ''}<button class="icon-button" data-view-asset="${asset.id}">Details</button>`;
  $('#assets-body').innerHTML = rows.length ? rows.map((asset) => { const status = asset.status || asset.condition_status; return `${'<tr>'}<td class="mono">${escapeHtml(asset.tag || asset.tag_code)}</td><td>${escapeHtml(asset.name)}</td><td>${escapeHtml(asset.category_name || asset.category)}</td><td>${escapeHtml(asset.location_name || '-')}</td><td><span class="status ${status}">${escapeHtml(status.replace('_', ' '))}</span></td>${state.user?.role === 'staff' ? '' : `<td>${asset.current_value === null ? '—' : Number(asset.current_book_value ?? asset.current_value ?? 0).toFixed(2)}</td>`}<td>${escapeHtml(asset.assigned_name || '-')}</td><td class="actions">${actions(asset)}</td></tr>`; }).join('') : '<tr><td class="empty-cell" colspan="8">No assets registered yet.</td></tr>';
}

function renderMaintenance() {
  $('#maintenance-body').innerHTML = state.maintenance.length ? state.maintenance.map((item) => { const overdue = item.status === 'scheduled' && new Date(`${item.scheduled_date}T23:59:59`) < new Date(); const label = overdue ? 'Overdue' : item.status === 'completed' ? 'Completed' : 'Upcoming'; const actions = state.user?.role === 'admin' ? `<button class="icon-button" data-edit-maintenance="${item.id}">Edit</button><button class="icon-button danger" data-delete-maintenance="${item.id}">Delete</button>` : state.user?.role === 'staff' && item.status !== 'completed' ? `<button class="icon-button" data-complete-maintenance="${item.id}">Mark complete</button>` : '<span class="muted">View only</span>'; return `<tr><td class="mono">${escapeHtml(item.tag || item.tag_code)}</td><td>${escapeHtml(item.asset_name)}</td><td>${escapeHtml(item.title || item.task)}</td><td>${dateText(item.scheduled_date)}</td><td><span class="status ${overdue ? 'overdue' : item.status}">${label}</span></td><td class="actions">${actions}</td></tr>`; }).join('') : '<tr><td class="empty-cell" colspan="6">No maintenance scheduled.</td></tr>';
}

function setForm(formId, values = {}) { const form = $(`#${formId}`); Object.entries(values).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; }); form.hidden = false; (form.elements[formId === 'asset-form' ? 'name' : 'task'] || form.elements[0]).focus(); }
function resetForm(formId) { $(`#${formId}`).reset(); $(`#${formId}`).elements.id.value = ''; $(`#${formId}`).hidden = true; }

async function loadAll() {
  [state.options, state.assets, state.maintenance] = await Promise.all([request('/options'), request('/assets'), request(`/maintenance${$('#maintenance-filter').value ? `?filter=${$('#maintenance-filter').value}` : ''}`)]);
  fillSelect('#asset-category', state.options.categories, 'Choose category', 'No categories found'); fillSelect('#asset-location', state.options.locations, 'Unassigned', 'No locations found'); fillSelect('#asset-assignee', state.options.users, 'Unassigned', 'No staff found');
  $('#maintenance-asset').innerHTML = state.assets.map((asset) => `<option value="${asset.id}">${escapeHtml(asset.tag_code)} - ${escapeHtml(asset.name)}</option>`).join('');
  renderAssets(); renderMaintenance(); await loadDashboard(); if (state.permissions.canSeeAudit) await loadAudit(); else $('#audit-body').innerHTML = '<tr><td class="empty-cell" colspan="4">Audit logs are restricted to management and audit roles.</td></tr>'; if (state.user.role === 'admin') await loadUsers();
}

async function loadUsers() { state.users = await request('/users'); $('#users-body').innerHTML = state.users.map((user) => `<tr><td>${escapeHtml(user.full_name)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(roleLabel(user.role))}</td><td>${escapeHtml(new Date(user.created_at).toLocaleDateString())}</td></tr>`).join(''); }

async function loadAudit() {
  const rows = await request('/audit');
  $('#audit-body').innerHTML = rows.length ? rows.map((item) => `<tr><td>${escapeHtml(new Date(item.created_at).toLocaleString())}</td><td>${escapeHtml(item.entity_type)} #${item.entity_id}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.details ? JSON.stringify(item.details) : '')}</td></tr>`).join('') : '<tr><td class="empty-cell" colspan="4">No history recorded yet.</td></tr>';
}

async function loadDashboard() {
  const [data, report] = await Promise.all([request('/dashboard'), request('/reports/summary')]); state.permissions = data.permissions || {}; const summary = data.summary;
  const values = [summary.total_assets, summary.working, summary.under_repair, summary.retired, summary.book_value === null ? '—' : Number(summary.book_value).toFixed(2), summary.maintenance_due];
  document.querySelectorAll('.kpi-value').forEach((element, index) => { element.textContent = values[index]; });
  const total = Number(summary.total_assets) || 1; document.querySelector('.bar-fill.working').style.width = `${summary.working / total * 100}%`; document.querySelector('.bar-fill.repair').style.width = `${summary.under_repair / total * 100}%`; document.querySelector('.bar-fill.retired').style.width = `${summary.retired / total * 100}%`;
  document.querySelectorAll('.bar-value').forEach((element, index) => { element.textContent = [summary.working, summary.under_repair, summary.retired][index]; });
  $('.panel-grid .panel:first-child').hidden = !state.permissions.canSeeAudit;
  $('.panel-grid .panel:first-child .empty-cell').textContent = data.recentActivity.length ? data.recentActivity.map((item) => `${item.action} ${item.entity_type} #${item.entity_id}`).join(' | ') : 'No activity yet.';
  $('.panel-grid .panel:last-child .empty-cell').textContent = data.upcomingMaintenance.length ? data.upcomingMaintenance.map((item) => `${item.task} (${dateText(item.scheduled_date)})`).join(' | ') : 'No maintenance scheduled.';
  $('#category-breakdown').innerHTML = report.categories.length ? report.categories.map((item) => `<p><span>${escapeHtml(item.category)}</span><strong>${item.count}</strong></p>`).join('') : '<p class="muted">No category data.</p>';
  $('#location-breakdown').innerHTML = report.locations.length ? report.locations.map((item) => `<p><span>${escapeHtml(item.location)}</span><strong>${item.count}</strong></p>`).join('') : '<p class="muted">No location data.</p>';
}

async function showAssetDetail(assetId) {
  const [asset, history, depreciation] = await Promise.all([request(`/assets/${assetId}`), request(`/assets/${assetId}/history`), request(`/assets/${assetId}/depreciation`)]);
  const detail = $('#asset-detail'); detail.hidden = false; detail.innerHTML = `<div class="detail-head"><div><p class="eyebrow">Asset detail</p><h3>${escapeHtml(asset.name)}</h3><p class="mono">${escapeHtml(asset.tag || asset.tag_code)}</p></div><div class="detail-actions"><button class="button" data-print-asset="${asset.id}">Print tag label</button><button class="button" data-close-detail>Close</button></div></div><div class="detail-grid"><div><img class="asset-qr" src="${api}/assets/${asset.id}/qr" alt="QR code for ${escapeHtml(asset.tag || asset.tag_code)}"><p>${escapeHtml(asset.qr_value || `ASSETTRACK:${asset.tag || asset.tag_code}`)}</p></div><div><p><strong>Status:</strong> <span class="status ${asset.status}">${escapeHtml(asset.status)}</span></p><p><strong>Book value:</strong> ${Number(depreciation.current_book_value).toFixed(2)}</p><p><strong>Serial:</strong> ${escapeHtml(asset.serial_number || '-')}</p><p><strong>Supplier:</strong> ${escapeHtml(asset.supplier || '-')}</p><label>Status<select data-status-asset="${asset.id}"><option value="working" ${asset.status === 'working' ? 'selected' : ''}>Working</option><option value="repair" ${asset.status === 'repair' ? 'selected' : ''}>Repair</option><option value="retired" ${asset.status === 'retired' ? 'selected' : ''}>Retired</option></select></label></div></div><h4>Location history</h4><ol class="timeline">${history.length ? history.map((item) => `<li><strong>${escapeHtml(item.location || 'Unassigned')}</strong> · ${escapeHtml(item.assigned_name || 'Unassigned')}<span>${dateText(item.changed_at)} by ${escapeHtml(item.changed_by_name)}</span></li>`).join('') : '<li>No location history yet.</li>'}</ol>`;
}

function printAssetLabel(asset) { const printWindow = window.open('', '_blank'); printWindow.document.write(`<title>AssetTrack label</title><main style="font-family:Arial;text-align:center"><img src="${api}/assets/${asset.id}/qr" width="240"><h1>${escapeHtml(asset.name)}</h1><p>${escapeHtml(asset.tag || asset.tag_code)}</p></main>`); printWindow.document.close(); printWindow.print(); }

document.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active')); link.classList.add('active'); document.querySelectorAll('.content').forEach((section) => { section.hidden = section.dataset.page !== link.dataset.page; }); }));
$('#asset-search').addEventListener('input', renderAssets);
$('#asset-search').addEventListener('keydown', async (event) => { if (event.key === 'Enter') { event.preventDefault(); const value = event.target.value.trim(); const asset = state.assets.find((item) => (item.tag || item.tag_code).toLowerCase() === value.toLowerCase()); if (asset) await showAssetDetail(asset.id); else window.alert('Asset tag not found.'); } });
$('#new-asset').addEventListener('click', () => setForm('asset-form'));
$('#new-maintenance').addEventListener('click', () => setForm('maintenance-form'));
$('#maintenance-filter').addEventListener('change', loadAll);
document.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', () => resetForm(button.dataset.cancel)));
$('#asset-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const values = formData(event.target); const id = values.id; delete values.id; if (id) { values.tag_code = state.assets.find((asset) => asset.id === Number(id)).tag || state.assets.find((asset) => asset.id === Number(id)).tag_code; values.condition_status = values.status; delete values.status; } const result = await request(id ? `/assets/${id}` : '/assets', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) }); if (id) state.assets[state.assets.findIndex((asset) => asset.id === Number(id))] = result; else state.assets.unshift(result); resetForm('asset-form'); renderAssets(); await loadDashboard(); } catch (error) { showError(error); } });
$('#maintenance-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const values = formData(event.target); const id = values.id; delete values.id; const result = await request(id ? `/maintenance/${id}` : '/maintenance', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) }); if (id) state.maintenance[state.maintenance.findIndex((item) => item.id === Number(id))] = { ...state.maintenance.find((item) => item.id === Number(id)), ...result }; else state.maintenance.unshift(result); resetForm('maintenance-form'); renderMaintenance(); await loadDashboard(); } catch (error) { showError(error); } });

$('#user-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await request('/auth/register', { method: 'POST', body: JSON.stringify(formData(event.target)) }); event.target.reset(); await loadUsers(); window.alert('User created successfully.'); } catch (error) { showError(error); } });

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.viewAsset) await showAssetDetail(Number(button.dataset.viewAsset));
    if (button.dataset.closeDetail !== undefined) $('#asset-detail').hidden = true;
    if (button.dataset.printAsset) printAssetLabel(state.assets.find((asset) => asset.id === Number(button.dataset.printAsset)));
    if (button.dataset.editAsset) setForm('asset-form', { ...state.assets.find((asset) => asset.id === Number(button.dataset.editAsset)), status: state.assets.find((asset) => asset.id === Number(button.dataset.editAsset)).status });
    if (button.dataset.deleteAsset && window.confirm('Delete this asset and its maintenance records?')) { await request(`/assets/${button.dataset.deleteAsset}`, { method: 'DELETE' }); await loadAll(); }
    if (button.dataset.approveRetirement && window.confirm('Approve this asset for retirement?')) { await request(`/assets/${button.dataset.approveRetirement}/approve-retirement`, { method: 'POST' }); await loadAll(); }
    if (button.dataset.editMaintenance) setForm('maintenance-form', state.maintenance.find((item) => item.id === Number(button.dataset.editMaintenance)));
    if (button.dataset.deleteMaintenance && window.confirm('Delete this maintenance record?')) { await request(`/maintenance/${button.dataset.deleteMaintenance}`, { method: 'DELETE' }); await loadAll(); }
    if (button.dataset.completeMaintenance && window.confirm('Mark this maintenance as completed?')) { await request(`/maintenance/${button.dataset.completeMaintenance}/complete`, { method: 'PATCH' }); await loadAll(); }
  } catch (error) { showError(error); }
});

document.addEventListener('change', async (event) => { const assetId = event.target.dataset.statusAsset; if (!assetId) return; try { await request(`/assets/${assetId}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); await loadAll(); await showAssetDetail(assetId); } catch (error) { showError(error); } });

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const values = formData(event.target); const errorBox = $('#login-error'); errorBox.hidden = true;
  try { const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(values) }); token = result.token; localStorage.setItem('assetTrackToken', token); showApp(result.user); await loadAll(); } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
});
$('#logout-button').addEventListener('click', async () => { try { if (token) await request('/auth/logout', { method: 'POST' }); } catch (error) { showError(error); } finally { token = null; localStorage.removeItem('assetTrackToken'); state.user = null; showLogin(); } });

async function initialize() {
  if (!token) return showLogin();
  try { const user = await request('/auth/me'); showApp(user); await loadAll(); } catch (error) { token = null; localStorage.removeItem('assetTrackToken'); showLogin('Please sign in to continue.'); }
}
initialize();