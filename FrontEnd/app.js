// The frontend may run on Live Server (5500), while the API runs on Express (3000).
const api = 'http://localhost:3000/api';
const state = { assets: [], maintenance: [], options: { categories: [], locations: [], users: [] }, users: [], user: null, permissions: {}, detailAsset: null, confirmAction: null, userRoleFilter: 'all' };
let token = localStorage.getItem('assetTrackToken');
let activeModal = null;
let modalReturnFocus = null;
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
const roleLabels = { admin: 'Admin', manager: 'Manager / Supervisor', staff: 'Staff / Encoder' };
const roleLabel = (role) => roleLabels[role] || String(role || '').replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
function showDashboardPage() { const dashboardLink = document.querySelector('.nav-item[data-page="dashboard"]'); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === dashboardLink)); document.querySelectorAll('.content').forEach((section) => { section.hidden = section.dataset.page !== 'dashboard'; }); }
function showApp(user) { state.user = user; $('#login-screen').hidden = true; $('#app').hidden = false; showDashboardPage(); $('#current-user-name').textContent = user.full_name; $('#current-user-role').textContent = roleLabel(user.role); document.querySelectorAll('.admin-only').forEach((element) => { element.hidden = user.role !== 'admin'; }); document.querySelectorAll('.admin-edit-only').forEach((element) => { element.hidden = !['admin'].includes(user.role); }); document.querySelectorAll('.manager-or-admin').forEach((element) => { element.hidden = !['admin', 'manager'].includes(user.role); }); document.querySelectorAll('.schedule-access').forEach((element) => { element.hidden = !['admin', 'manager', 'staff'].includes(user.role); }); document.querySelectorAll('.financial-only').forEach((element) => { element.hidden = user.role === 'staff'; }); document.querySelectorAll('.management-only').forEach((element) => { element.hidden = !['admin', 'manager'].includes(user.role); }); document.querySelectorAll('.company-dashboard').forEach((element) => { element.hidden = user.role === 'staff'; }); document.querySelectorAll('.staff-dashboard').forEach((element) => { element.hidden = user.role !== 'staff'; }); }
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function fillSelect(selector, items, emptyLabel, emptyState = 'No options found') {
  const select = $(selector);
  select.innerHTML = items.length
    ? `<option value="">${emptyLabel}</option>${items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}`
    : `<option value="" disabled selected>${emptyState}</option>`;
}
function downloadCsv(filename, rows) { const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function modalFocusable(modal) { return [...modal.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled && !element.hidden); }
function openModal(id, focusSelector = '') { closeModal(); const modal = $(`#${id}`); if (!modal) return; modalReturnFocus = document.activeElement; modal.hidden = false; activeModal = modal; document.body.classList.add('modal-open'); const target = focusSelector ? modal.querySelector(focusSelector) : modalFocusable(modal)[0]; if (target) target.focus(); }
function closeModal() { if (!activeModal) return; activeModal.hidden = true; activeModal = null; document.body.classList.remove('modal-open'); if (modalReturnFocus?.focus) modalReturnFocus.focus(); modalReturnFocus = null; }
function showAssetFormError(error) { const errorBox = $('#asset-form-error'); errorBox.textContent = error.message; errorBox.hidden = false; }
function showMaintenanceFormError(error) { const errorBox = $('#maintenance-form-error'); errorBox.textContent = error.message; errorBox.hidden = false; }
function openConfirm(message, action) { state.confirmAction = action; $('#confirm-message').textContent = message; openModal('confirm-modal', '#confirm-action'); }

function renderAssets() {
  const query = ($('#asset-search').value || '').toLowerCase();
  const rows = state.assets.filter((asset) => `${asset.tag || asset.tag_code} ${asset.name}`.toLowerCase().includes(query));
  const actions = (asset) => `${state.user?.role === 'admin' ? `<button class="icon-button" data-edit-asset="${asset.id}">Edit</button><button class="icon-button danger" data-delete-asset="${asset.id}">Delete</button>` : ['manager', 'staff'].includes(state.user?.role) ? `<button class="icon-button" data-edit-asset="${asset.id}">Update</button>` : ''}<button class="icon-button" data-view-asset="${asset.id}">Details</button>`;
  $('#assets-body').innerHTML = rows.length ? rows.map((asset) => { const status = asset.status || asset.condition_status; return `${'<tr>'}<td class="mono">${escapeHtml(asset.tag || asset.tag_code)}</td><td>${escapeHtml(asset.name)}</td><td>${escapeHtml(asset.category_name || asset.category)}</td><td>${escapeHtml(asset.location_name || '-')}</td><td><span class="status ${status}">${escapeHtml(status.replace('_', ' '))}</span></td>${state.user?.role === 'staff' ? '' : `<td>${asset.current_value === null ? '—' : Number(asset.current_book_value ?? asset.current_value ?? 0).toFixed(2)}</td>`}<td>${escapeHtml(asset.assigned_name || '-')}</td><td class="actions">${actions(asset)}</td></tr>`; }).join('') : '<tr><td class="empty-cell" colspan="8">No assets registered yet.</td></tr>';
}

function renderMaintenance() {
  $('#maintenance-body').innerHTML = state.maintenance.length ? state.maintenance.map((item) => { const overdue = item.status === 'scheduled' && new Date(`${item.scheduled_date}T23:59:59`) < new Date(); const label = overdue ? 'Overdue' : item.status === 'completed' ? 'Completed' : 'Upcoming'; const approval = item.approval_status === 'pending' && ['admin', 'manager'].includes(state.user?.role) ? `<button class="icon-button" data-approve-maintenance="${item.id}">Approve</button><button class="icon-button danger" data-reject-maintenance="${item.id}">Reject</button>` : `<span class="muted">${escapeHtml(item.approval_status || 'approved')}</span>`; const actions = state.user?.role === 'admin' ? `<button class="icon-button" data-edit-maintenance="${item.id}">Edit</button><button class="icon-button danger" data-delete-maintenance="${item.id}">Delete</button>` : state.user?.role === 'staff' && item.status !== 'completed' ? `<button class="icon-button" data-complete-maintenance="${item.id}">Mark complete</button>` : '<span class="muted">View only</span>'; return `<tr><td class="mono">${escapeHtml(item.tag || item.tag_code)}</td><td>${escapeHtml(item.asset_name)}</td><td>${escapeHtml(item.title || item.task)}</td><td>${dateText(item.scheduled_date)}</td><td><span class="status ${overdue ? 'overdue' : item.status}">${label}</span></td><td>${approval}</td><td class="actions">${actions}</td></tr>`; }).join('') : '<tr><td class="empty-cell" colspan="7">No maintenance scheduled.</td></tr>';
}

function setForm(formId, values = {}) { const form = $(`#${formId}`); if (formId === 'asset-form' && !values.id) { form.reset(); ['purchase_cost', 'useful_life_years', 'salvage_value', 'current_value'].forEach((name) => { form.elements[name].value = ''; }); } if (formId === 'maintenance-form' && !values.id) { form.reset(); ['asset_id', 'task', 'scheduled_date', 'notes'].forEach((name) => { form.elements[name].value = ''; }); } Object.entries(values).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; }); if (formId === 'asset-form') { $('#asset-form-error').hidden = true; $('#asset-form-title').textContent = values.id ? 'Edit asset' : 'Register asset'; openModal('asset-form-modal', '[name="name"]'); } else if (formId === 'maintenance-form') { $('#maintenance-form-error').hidden = true; $('#maintenance-form-title').textContent = values.id ? 'Edit maintenance' : 'Schedule maintenance'; openModal('maintenance-form-modal', '[name="task"]'); } else { form.hidden = false; (form.elements[formId === 'asset-form' ? 'name' : 'task'] || form.elements[0]).focus(); } }
function resetForm(formId) { $(`#${formId}`).reset(); $(`#${formId}`).elements.id.value = ''; if (formId === 'asset-form' || formId === 'maintenance-form') closeModal(); else $(`#${formId}`).hidden = true; }

async function loadAll() {
  [state.options, state.assets, state.maintenance] = await Promise.all([request('/options'), request('/assets'), request(`/maintenance${$('#maintenance-filter').value ? `?filter=${$('#maintenance-filter').value}` : ''}`)]);
  fillSelect('#asset-category', state.options.categories, 'Choose category', 'No categories found'); fillSelect('#asset-location', state.options.locations, 'Unassigned', 'No locations found'); fillSelect('#asset-assignee', state.options.users, 'Unassigned', 'No staff found');
  $('#maintenance-asset').innerHTML = state.assets.map((asset) => `<option value="${asset.id}">${escapeHtml(asset.tag_code)} - ${escapeHtml(asset.name)}</option>`).join('');
  renderAssets(); renderMaintenance(); await loadDashboard(); if (state.permissions.canSeeAudit) await loadAudit(); else $('#audit-body').innerHTML = '<tr><td class="empty-cell" colspan="4">Audit logs are restricted to management and audit roles.</td></tr>'; if (state.user.role === 'admin') await loadUsers();
}

function renderUsers() { const filter = state.userRoleFilter; const users = filter === 'all' ? state.users : state.users.filter((user) => user.role === filter); $('#user-count').textContent = `${state.users.length} user${state.users.length === 1 ? '' : 's'}`; $('#users-body').innerHTML = users.length ? users.map((user) => { const activeStatus = user.is_active ? 'active' : 'inactive'; const approvalStatus = user.approval_status ? ` · ${user.approval_status}` : ''; const status = `${activeStatus}${approvalStatus}`; const approval = user.approval_status === 'pending' ? `<button class="icon-button" data-approve-user="${user.id}">Approve</button><button class="icon-button danger" data-reject-user="${user.id}">Reject</button>` : ''; const active = user.id === state.user.id ? '' : `<button class="icon-button" data-toggle-user="${user.id}" data-active="${user.is_active ? 'false' : 'true'}">${user.is_active ? 'Deactivate' : 'Activate'}</button>`; return `<tr><td>${escapeHtml(user.full_name)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(roleLabel(user.role))}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(new Date(user.created_at).toLocaleDateString())}</td><td class="actions">${approval}${active}</td></tr>`; }).join('') : '<tr><td class="empty-cell" colspan="6">No users match this role.</td></tr>'; }
async function loadUsers() { state.users = await request('/users'); renderUsers(); }

async function loadAudit() {
  const rows = await request('/audit');
  $('#audit-body').innerHTML = rows.length ? rows.map((item) => `<tr><td>${escapeHtml(new Date(item.created_at).toLocaleString())}</td><td>${escapeHtml(item.entity_type)} #${item.entity_id}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.details ? JSON.stringify(item.details) : '')}</td></tr>`).join('') : '<tr><td class="empty-cell" colspan="4">No history recorded yet.</td></tr>';
}

async function loadDashboard() {
  const data = await request('/dashboard'); state.permissions = data.permissions || {}; const summary = data.summary;
  if (state.user.role === 'staff') { const assignedAssets = state.assets; $('#staff-total-assets').textContent = assignedAssets.length; $('#staff-working-assets').textContent = assignedAssets.filter((asset) => (asset.status || asset.condition_status) === 'working').length; $('#staff-repair-assets').textContent = assignedAssets.filter((asset) => ['repair', 'under_repair'].includes(asset.status || asset.condition_status)).length; $('#staff-maintenance-due').textContent = data.upcomingMaintenance.length; $('#staff-maintenance-summary').innerHTML = data.upcomingMaintenance.length ? data.upcomingMaintenance.map((item) => `<p><span>${escapeHtml(item.task)}</span><strong>${dateText(item.scheduled_date)}</strong></p>`).join('') : '<p class="muted">No pending maintenance assigned to you.</p>'; return; }
  const report = await request('/reports/summary');
  const values = [summary.total_assets, summary.working, summary.under_repair, summary.retired, summary.book_value === null ? '—' : Number(summary.book_value).toFixed(2), summary.maintenance_due];
  document.querySelectorAll('.kpi-value').forEach((element, index) => { element.textContent = values[index]; });
  const total = Number(summary.total_assets) || 1; document.querySelector('.bar-fill.working').style.width = `${summary.working / total * 100}%`; document.querySelector('.bar-fill.repair').style.width = `${summary.under_repair / total * 100}%`; document.querySelector('.bar-fill.retired').style.width = `${summary.retired / total * 100}%`;
  document.querySelectorAll('.bar-value').forEach((element, index) => { element.textContent = [summary.working, summary.under_repair, summary.retired][index]; });
  $('.panel-grid .panel:first-child').hidden = !state.permissions.canSeeAudit;
  $('#recent-activity-list').innerHTML = data.recentActivity.length ? data.recentActivity.map((item) => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${escapeHtml(item.action)}</strong><span>${escapeHtml(item.entity_type)} #${escapeHtml(item.entity_id)}</span></div><time>${escapeHtml(new Date(item.created_at).toLocaleString())}</time></div>`).join('') : '<p class="empty-cell">No activity yet.</p>';
  $('.panel-grid .panel:last-child .empty-cell').textContent = data.upcomingMaintenance.length ? data.upcomingMaintenance.map((item) => `${item.task} (${dateText(item.scheduled_date)})`).join(' | ') : 'No maintenance scheduled.';
  $('#category-breakdown').innerHTML = report.categories.length ? report.categories.map((item) => `<p><span>${escapeHtml(item.category)}</span><strong>${item.count}</strong></p>`).join('') : '<p class="muted">No category data.</p>';
  $('#location-breakdown').innerHTML = report.locations.length ? report.locations.map((item) => `<p><span>${escapeHtml(item.location)}</span><strong>${item.count}</strong></p>`).join('') : '<p class="muted">No location data.</p>';
}

async function showAssetDetail(assetId) {
  const requests = [request(`/assets/${assetId}`), request(`/assets/${assetId}/history`)]; if (state.user.role !== 'staff') requests.push(request(`/assets/${assetId}/depreciation`)); const [asset, history, depreciation] = await Promise.all(requests);
  const financialDetail = state.user.role === 'staff' ? '' : `<p><strong>Book value:</strong> ${Number(depreciation.current_book_value).toFixed(2)}</p>`; const statusControl = ['admin', 'manager', 'staff'].includes(state.user.role) ? `<label>Status<select data-status-asset="${asset.id}"><option value="working" ${asset.status === 'working' ? 'selected' : ''}>Working</option><option value="repair" ${asset.status === 'repair' ? 'selected' : ''}>Repair</option><option value="retired" ${asset.status === 'retired' ? 'selected' : ''}>Retired</option></select></label>` : '';
  state.detailAsset = asset; $('#asset-detail-title').textContent = asset.name; const detail = $('#asset-detail'); detail.innerHTML = `<div class="detail-head"><div><p class="eyebrow">Asset detail</p><h3>${escapeHtml(asset.name)}</h3><p class="mono">${escapeHtml(asset.tag || asset.tag_code)}</p></div></div><div class="detail-grid"><div><img class="asset-qr" src="${api}/assets/${asset.id}/qr" alt="QR code for ${escapeHtml(asset.tag || asset.tag_code)}"><p>${escapeHtml(asset.qr_value || `ASSETTRACK:${asset.tag || asset.tag_code}`)}</p></div><div><p><strong>Status:</strong> <span class="status ${asset.status}">${escapeHtml(asset.status)}</span></p>${financialDetail}<p><strong>Serial:</strong> ${escapeHtml(asset.serial_number || '-')}</p><p><strong>Supplier:</strong> ${escapeHtml(asset.supplier || '-')}</p>${statusControl}</div></div><h4>Location history</h4><ol class="timeline">${history.length ? history.map((item) => `<li><strong>${escapeHtml(item.location || 'Unassigned')}</strong> · ${escapeHtml(item.assigned_name || 'Unassigned')}<span>${dateText(item.changed_at)} by ${escapeHtml(item.changed_by_name)}</span></li>`).join('') : '<li>No location history yet.</li>'}</ol>`; openModal('asset-detail-modal');
}

function printAssetLabel(asset) { const printWindow = window.open('', '_blank'); printWindow.document.write(`<title>AssetTrack label</title><main style="font-family:Arial;text-align:center"><img src="${api}/assets/${asset.id}/qr" width="240"><h1>${escapeHtml(asset.name)}</h1><p>${escapeHtml(asset.tag || asset.tag_code)}</p></main>`); printWindow.document.close(); printWindow.print(); }

document.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active')); link.classList.add('active'); document.querySelectorAll('.content').forEach((section) => { section.hidden = section.dataset.page !== link.dataset.page; }); }));
$('#asset-search').addEventListener('input', renderAssets);
$('#asset-search').addEventListener('keydown', async (event) => { if (event.key === 'Enter') { event.preventDefault(); const value = event.target.value.trim(); const asset = state.assets.find((item) => (item.tag || item.tag_code).toLowerCase() === value.toLowerCase()); if (asset) await showAssetDetail(asset.id); else window.alert('Asset tag not found.'); } });
$('#new-asset').addEventListener('click', () => setForm('asset-form'));
$('#new-maintenance').addEventListener('click', () => setForm('maintenance-form'));
$('#maintenance-filter').addEventListener('change', loadAll);
$('#export-assets').addEventListener('click', () => downloadCsv('assettrack-assets.csv', [['Tag', 'Name', 'Category', 'Location', 'Condition', 'Assigned to'], ...state.assets.map((asset) => [asset.tag || asset.tag_code, asset.name, asset.category_name || asset.category, asset.location_name, asset.status || asset.condition_status, asset.assigned_name])]));
$('#export-maintenance').addEventListener('click', () => downloadCsv('assettrack-maintenance.csv', [['Tag', 'Asset', 'Task', 'Scheduled', 'Status', 'Approval'], ...state.maintenance.map((item) => [item.tag || item.tag_code, item.asset_name, item.title || item.task, item.scheduled_date, item.status, item.approval_status])]));
$('#print-report').addEventListener('click', () => window.print());
document.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', () => resetForm(button.dataset.cancel)));
document.querySelectorAll('.modal-backdrop').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); }));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { if (activeModal) closeModal(); else if (!$('#completion-modal').hidden) $('#completion-modal').hidden = true; return; }
  if (event.key !== 'Tab' || !activeModal) return;
  const focusable = modalFocusable(activeModal); if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$('#asset-form').addEventListener('submit', async (event) => { event.preventDefault(); $('#asset-form-error').hidden = true; try { const values = formData(event.target); const id = values.id; delete values.id; if (id) { values.tag_code = state.assets.find((asset) => asset.id === Number(id)).tag || state.assets.find((asset) => asset.id === Number(id)).tag_code; values.condition_status = values.status; delete values.status; } const result = await request(id ? `/assets/${id}` : '/assets', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) }); if (id) state.assets[state.assets.findIndex((asset) => asset.id === Number(id))] = result; else state.assets.unshift(result); resetForm('asset-form'); renderAssets(); await loadDashboard(); } catch (error) { showAssetFormError(error); } });
$('#maintenance-form').addEventListener('submit', async (event) => { event.preventDefault(); $('#maintenance-form-error').hidden = true; try { const values = formData(event.target); const id = values.id; delete values.id; const result = await request(id ? `/maintenance/${id}` : '/maintenance', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) }); if (id) state.maintenance[state.maintenance.findIndex((item) => item.id === Number(id))] = { ...state.maintenance.find((item) => item.id === Number(id)), ...result }; else state.maintenance.unshift(result); resetForm('maintenance-form'); renderMaintenance(); await loadDashboard(); } catch (error) { showMaintenanceFormError(error); } });
$('#completion-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const values = formData(event.target); await request(`/maintenance/${values.maintenance_id}/complete`, { method: 'PATCH', body: JSON.stringify({ notes: values.notes }) }); $('#completion-modal').hidden = true; event.target.reset(); await loadAll(); } catch (error) { showError(error); } });
document.querySelectorAll('[data-close-completion]').forEach((button) => button.addEventListener('click', () => { $('#completion-modal').hidden = true; $('#completion-form').reset(); }));
$('#confirm-action').addEventListener('click', async () => { const action = state.confirmAction; closeModal(); state.confirmAction = null; if (action) await action(); });

$('#user-form').addEventListener('submit', async (event) => { event.preventDefault(); $('#user-form-error').hidden = true; $('#user-form-success').hidden = true; try { await request('/auth/register', { method: 'POST', body: JSON.stringify(formData(event.target)) }); event.target.reset(); await loadUsers(); closeModal(); window.alert('User created successfully.'); } catch (error) { $('#user-form-error').textContent = error.message; $('#user-form-error').hidden = false; } });
$('#user-role-filter').addEventListener('change', (event) => { state.userRoleFilter = event.target.value; renderUsers(); });
document.querySelectorAll('[data-open-user-modal]').forEach((card) => card.addEventListener('click', () => { if (card.dataset.openUserModal === 'add') { $('#user-form').reset(); $('#user-form-error').hidden = true; $('#user-form-success').hidden = true; openModal('add-user-modal', '[name="full_name"]'); } else { renderUsers(); openModal('manage-users-modal', '#user-role-filter'); } }));

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.viewAsset) await showAssetDetail(Number(button.dataset.viewAsset));
    if (button.dataset.closeModal !== undefined) closeModal();
    if (button.dataset.printCurrentAsset && state.detailAsset) printAssetLabel(state.detailAsset);
    if (button.dataset.editAsset) setForm('asset-form', { ...state.assets.find((asset) => asset.id === Number(button.dataset.editAsset)), status: state.assets.find((asset) => asset.id === Number(button.dataset.editAsset)).status });
    if (button.dataset.deleteAsset) openConfirm('Delete this asset and its maintenance records?', async () => { await request(`/assets/${button.dataset.deleteAsset}`, { method: 'DELETE' }); await loadAll(); });
    if (button.dataset.approveRetirement && window.confirm('Approve this asset for retirement?')) { await request(`/assets/${button.dataset.approveRetirement}/approve-retirement`, { method: 'POST' }); await loadAll(); }
    if (button.dataset.editMaintenance) setForm('maintenance-form', state.maintenance.find((item) => item.id === Number(button.dataset.editMaintenance)));
    if (button.dataset.deleteMaintenance) openConfirm('Delete this maintenance record?', async () => { await request(`/maintenance/${button.dataset.deleteMaintenance}`, { method: 'DELETE' }); await loadAll(); });
    if (button.dataset.completeMaintenance) { $('#completion-form').elements.maintenance_id.value = button.dataset.completeMaintenance; $('#completion-modal').hidden = false; $('#completion-form').elements.notes.focus(); }
    if (button.dataset.approveMaintenance) { await request(`/maintenance/${button.dataset.approveMaintenance}/approval`, { method: 'PATCH', body: JSON.stringify({ approval_status: 'approved' }) }); await loadAll(); }
    if (button.dataset.rejectMaintenance) { await request(`/maintenance/${button.dataset.rejectMaintenance}/approval`, { method: 'PATCH', body: JSON.stringify({ approval_status: 'rejected' }) }); await loadAll(); }
    if (button.dataset.approveUser) { await request(`/users/${button.dataset.approveUser}/approve`, { method: 'POST' }); await loadUsers(); }
    if (button.dataset.rejectUser) { await request(`/users/${button.dataset.rejectUser}/reject`, { method: 'POST' }); await loadUsers(); }
    if (button.dataset.toggleUser) { await request(`/users/${button.dataset.toggleUser}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: button.dataset.active === 'true' }) }); await loadUsers(); }
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