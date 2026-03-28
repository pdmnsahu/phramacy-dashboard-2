const state = {
  manufacturers: [],
  medicines: [],
  purchases: [],
  sales: [],
  writeoffs: [],
  dashboard: null,
  presets: null,
  currentPage: 'dashboard'
};

const $ = (sel) => document.querySelector(sel);
const fmtCurrency = (n) => `₹${Number(n || 0).toFixed(2)}`;
const fmtDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const today = new Date().toISOString().slice(0, 10);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function fullMedicineName(item) {
  return [item.name || item.medicine_name, item.strength, item.form].filter(Boolean).join(' • ');
}
function badge(text, kind = 'ok') {
  return `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
}
function showToast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.style.background = isError ? '#b91c1c' : '#0f172a';
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}
async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function renderSimpleRows(el, rows, colspan, renderer, emptyText = 'No records found.') {
  el.innerHTML = rows.length ? rows.map(renderer).join('') : `<tr><td colspan="${colspan}" class="empty">${emptyText}</td></tr>`;
}
function setPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('[data-page-link]').forEach((el) => el.classList.remove('active'));
  $(`#page-${page}`).classList.add('active');
  document.querySelectorAll(`[data-page-link="${page}"]`).forEach((el) => el.classList.add('active'));
  $('#pageTitle').textContent = page === 'writeoffs' ? 'Discard / Write-off' : page === 'reports' ? 'Profit Reports' : page[0].toUpperCase() + page.slice(1);
  if (page === 'dashboard') loadDashboard();
  if (page === 'reports') loadReportFromForm();
}

async function refreshLookups() {
  [state.manufacturers, state.medicines] = await Promise.all([
    api('/api/manufacturers'),
    api('/api/medicines')
  ]);
  renderManufacturers();
  renderMedicines();
  fillManufacturerSelects();
  fillMedicineSelects();
}
async function refreshTransactions() {
  [state.purchases, state.sales, state.writeoffs] = await Promise.all([
    api('/api/purchases'),
    api('/api/sales'),
    api('/api/write-offs')
  ]);
  renderPurchases();
  renderSales();
  renderWriteoffs();
}
async function refreshAll() {
  await refreshLookups();
  await refreshTransactions();
  await loadDashboard();
  if ($('#saleMedicine').value) await updateSaleBatchOptions();
  if ($('#writeoffMedicine').value) await updateWriteoffBatchOptions();
}

function fillManufacturerSelects() {
  $('#medicineManufacturer').innerHTML = ['<option value="">Select manufacturer</option>']
    .concat(state.manufacturers.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`))
    .join('');
}
function fillMedicineSelects() {
  const options = ['<option value="">Select medicine</option>']
    .concat(state.medicines.map((m) => `<option value="${m.id}">${escapeHtml(fullMedicineName(m))} — ${escapeHtml(m.manufacturer_name)}</option>`))
    .join('');
  $('#purchaseMedicine').innerHTML = options;
  $('#saleMedicine').innerHTML = options;
  $('#writeoffMedicine').innerHTML = options;
}

function renderManufacturers() {
  renderSimpleRows($('#manufacturersTable'), state.manufacturers, 2, (item) => `<tr><td>${escapeHtml(item.name)}</td><td>${fmtDate(item.created_at.slice(0,10))}</td></tr>`);
}
function renderMedicines() {
  renderSimpleRows($('#medicinesTable'), state.medicines, 5, (item) => `
    <tr>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.manufacturer_name)}</td>
      <td>${item.total_stock}</td>
      <td>${item.stock_status === 'out' ? badge('Out of stock', 'danger') : item.stock_status === 'low' ? badge(`Low (≤ ${item.reorder_level})`, 'warning') : badge('Healthy', 'success')}</td>
      <td>${fmtDate(item.nearest_expiry)}</td>
    </tr>`);
}
function renderPurchases() {
  renderSimpleRows($('#purchasesTable'), state.purchases, 8, (item) => `
    <tr>
      <td>${fmtDate(item.purchased_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${fmtDate(item.expiry_date)}</td>
      <td>${fmtCurrency(item.cost_price)}</td>
      <td>${fmtCurrency(item.mrp)}</td>
      <td>${item.quantity_purchased}</td>
      <td>${item.quantity_available}</td>
    </tr>`);
}
function renderSales() {
  renderSimpleRows($('#salesTable'), state.sales, 6, (item) => `
    <tr>
      <td>${fmtDate(item.sold_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${item.quantity_sold}</td>
      <td>${fmtCurrency(item.sale_value)}</td>
      <td>${fmtCurrency(item.profit)}</td>
    </tr>`);
}
function renderWriteoffs() {
  renderSimpleRows($('#writeoffsTable'), state.writeoffs, 6, (item) => `
    <tr>
      <td>${fmtDate(item.discarded_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${item.quantity_discarded}</td>
      <td>${fmtCurrency(item.loss_value)}</td>
    </tr>`);
}

async function loadDashboard() {
  const data = await api('/api/dashboard');
  state.dashboard = data;
  state.presets = data.presets;
  const s = data.summary;
  $('#statMedicines').textContent = s.total_medicines;
  $('#statManufacturers').textContent = s.total_manufacturers;
  $('#statUnits').textContent = s.total_units;
  $('#statLow').textContent = s.low_stock_medicines;
  $('#statExpired').textContent = s.expired_batches;
  $('#statNearExpiry').textContent = s.near_expiry_batches;
  $('#statTodaySales').textContent = fmtCurrency(s.today_sales);
  $('#statTodayProfit').textContent = fmtCurrency(s.today_profit);
  $('#statLastWeekProfit').textContent = fmtCurrency(s.last_week_profit);
  $('#statLastMonthProfit').textContent = fmtCurrency(s.last_month_profit);
  $('#statStockValue').textContent = fmtCurrency(s.current_stock_value);
  $('#statExpiredValue').textContent = fmtCurrency(s.expired_stock_value);
  $('#statWriteoffLoss').textContent = `Today's write-off loss ${fmtCurrency(s.today_writeoff_loss)}`;
  $('#statTodayUnits').textContent = `${s.today_units} units sold`;

  renderSimpleRows($('#lowStockTable'), data.lowStock, 4, (item) => `<tr><td>${escapeHtml(fullMedicineName(item))}</td><td>${escapeHtml(item.manufacturer_name)}</td><td>${item.total_stock}</td><td>${item.reorder_level}</td></tr>`);
  renderSimpleRows($('#nearExpiryTable'), data.nearExpiry, 4, (item) => `<tr><td>${escapeHtml(item.medicine_name)}</td><td>${escapeHtml(item.batch_number)}</td><td>${fmtDate(item.expiry_date)}</td><td>${item.quantity_available}</td></tr>`);
  renderSimpleRows($('#expiredBatchesTable'), data.expiredBatches, 4, (item) => `<tr><td>${escapeHtml(item.medicine_name)}</td><td>${escapeHtml(item.batch_number)}</td><td>${item.quantity_available}</td><td>${fmtCurrency(item.loss_value)}</td></tr>`, 'No expired stock pending discard.');
  renderSimpleRows($('#recentWriteOffsTable'), data.recentWriteOffs, 4, (item) => `<tr><td>${fmtDate(item.discarded_on)}</td><td>${escapeHtml(item.medicine_name)}</td><td>${escapeHtml(item.reason)}</td><td>${fmtCurrency(item.loss_value)}</td></tr>`, 'No write-offs yet.');
  renderSimpleRows($('#topMedicinesTable'), data.topMedicines, 3, (item) => `<tr><td>${escapeHtml(item.medicine_name)}</td><td>${item.units_sold}</td><td>${fmtCurrency(item.profit)}</td></tr>`, 'No sales in the last 30 days.');

  if (!$('#reportFrom').value && state.presets) applyPreset('today');
}

async function updateSaleBatchOptions() {
  const medicineId = $('#saleMedicine').value;
  const saleBatch = $('#saleBatch');
  if (!medicineId) {
    saleBatch.innerHTML = '<option value="">Select batch</option>';
    $('#batchHint').textContent = 'Select a medicine to auto-pick the batch closest to expiry.';
    return;
  }
  const data = await api(`/api/medicines/${medicineId}/sale-options`);
  const sellable = data.batches.filter((b) => !b.is_expired);
  if (!sellable.length) {
    saleBatch.innerHTML = '<option value="">No sellable batch available</option>';
    $('#batchHint').textContent = 'No non-expired batch with stock is available for sale.';
    return;
  }
  saleBatch.innerHTML = sellable.map((b) => `<option value="${b.id}" ${b.id === data.default_batch_id ? 'selected' : ''}>${escapeHtml(b.batch_number)} • exp ${b.expiry_date} • stock ${b.quantity_available} • MRP ${fmtCurrency(b.mrp)}</option>`).join('');
  const first = sellable.find((b) => b.id === data.default_batch_id) || sellable[0];
  $('#batchHint').innerHTML = `Default batch selected: <strong>${escapeHtml(first.batch_number)}</strong>, because it expires first on <strong>${fmtDate(first.expiry_date)}</strong>.`;
}
async function updateWriteoffBatchOptions() {
  const medicineId = $('#writeoffMedicine').value;
  const el = $('#writeoffBatch');
  if (!medicineId) {
    el.innerHTML = '<option value="">Select batch</option>';
    $('#writeoffHint').textContent = 'Select a medicine to pick a batch for discard or adjustment.';
    return;
  }
  const data = await api(`/api/medicines/${medicineId}/discard-options`);
  if (!data.batches.length) {
    el.innerHTML = '<option value="">No batch available</option>';
    $('#writeoffHint').textContent = 'This medicine has no available stock to discard.';
    return;
  }
  el.innerHTML = data.batches.map((b) => `<option value="${b.id}" ${b.id === data.default_batch_id ? 'selected' : ''}>${escapeHtml(b.batch_number)} • exp ${b.expiry_date} • stock ${b.quantity_available} ${b.is_expired ? '• EXPIRED' : ''}</option>`).join('');
  const first = data.batches.find((b) => b.id === data.default_batch_id) || data.batches[0];
  $('#writeoffHint').innerHTML = `${first.is_expired ? 'Expired batch prioritised' : 'Closest-expiry batch selected'}: <strong>${escapeHtml(first.batch_number)}</strong> with <strong>${first.quantity_available}</strong> units remaining.`;
}

function handleSubmit(formId, path, successMessage) {
  const form = $(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
      form.reset();
      ['purchased_on', 'sold_on', 'discarded_on'].forEach((name) => {
        const field = form.querySelector(`[name="${name}"]`);
        if (field) field.value = today;
      });
      await refreshAll();
      showToast(successMessage);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function applyPreset(name) {
  if (!state.presets || !state.presets[name]) return;
  $('#reportFrom').value = state.presets[name].from;
  $('#reportTo').value = state.presets[name].to;
}
async function loadReportFromForm() {
  const from = $('#reportFrom').value;
  const to = $('#reportTo').value;
  if (!from || !to) return;
  try {
    const data = await api(`/api/reports/profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    $('#reportSales').textContent = fmtCurrency(data.summary.sales_amount);
    $('#reportCogs').textContent = fmtCurrency(data.summary.cogs);
    $('#reportProfit').textContent = fmtCurrency(data.summary.gross_profit);
    $('#reportWriteoff').textContent = fmtCurrency(data.summary.writeoff_loss);
    $('#reportUnits').textContent = data.summary.units_sold;
    $('#reportEntries').textContent = data.summary.sale_entries;

    renderSimpleRows($('#reportMedicineTable'), data.byMedicine, 4, (item) => `<tr><td>${escapeHtml(item.medicine_name)}<div class="subtext">${escapeHtml(item.manufacturer_name)}</div></td><td>${item.units_sold}</td><td>${fmtCurrency(item.sales_amount)}</td><td>${fmtCurrency(item.gross_profit)}</td></tr>`, 'No sales in this period.');
    renderSimpleRows($('#reportDailyTable'), data.daily, 4, (item) => `<tr><td>${fmtDate(item.sold_on)}</td><td>${item.units_sold}</td><td>${fmtCurrency(item.sales_amount)}</td><td>${fmtCurrency(item.gross_profit)}</td></tr>`, 'No daily trend available.');
  } catch (err) {
    showToast(err.message, true);
  }
}

function bootNavigation() {
  document.querySelectorAll('[data-page-link]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault();
    setPage(btn.dataset.pageLink);
  }));
}

async function init() {
  $('#topbarDate').textContent = new Date().toLocaleString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#purchaseForm [name="purchased_on"]').value = today;
  $('#saleForm [name="sold_on"]').value = today;
  $('#writeoffForm [name="discarded_on"]').value = today;

  bootNavigation();
  handleSubmit('#manufacturerForm', '/api/manufacturers', 'Manufacturer saved.');
  handleSubmit('#medicineForm', '/api/medicines', 'Medicine saved and thresholds updated.');
  handleSubmit('#purchaseForm', '/api/purchases', 'Purchase saved. Dashboard and stock updated instantly.');
  handleSubmit('#saleForm', '/api/sales', 'Sale saved. Profit and inventory updated instantly.');
  handleSubmit('#writeoffForm', '/api/write-offs', 'Write-off saved. Expiry loss and stock updated instantly.');

  $('#saleMedicine').addEventListener('change', updateSaleBatchOptions);
  $('#writeoffMedicine').addEventListener('change', updateWriteoffBatchOptions);
  $('#reportPreset').addEventListener('change', (e) => {
    if (e.target.value !== 'custom') applyPreset(e.target.value);
    loadReportFromForm();
  });
  $('#reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#reportPreset').value = 'custom';
    await loadReportFromForm();
  });

  await refreshAll();
  applyPreset('today');
  await loadReportFromForm();
}

init().catch((err) => showToast(err.message, true));
