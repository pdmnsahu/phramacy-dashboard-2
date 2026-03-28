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
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
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
function actionButtons(kind, id) {
  return `<div class="table-actions"><button class="btn btn-ghost btn-xs" data-action="edit-${kind}" data-id="${id}">Edit</button><button class="btn btn-danger btn-xs" data-action="delete-${kind}" data-id="${id}">Delete</button></div>`;
}

function renderManufacturers() {
  renderSimpleRows($('#manufacturersTable'), state.manufacturers, 3, (item) => `<tr><td>${escapeHtml(item.name)}</td><td>${fmtDate(item.created_at.slice(0,10))}</td><td>${actionButtons('manufacturer', item.id)}</td></tr>`);
}
function renderMedicines() {
  renderSimpleRows($('#medicinesTable'), state.medicines, 6, (item) => `
    <tr>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.manufacturer_name)}</td>
      <td>${item.total_stock}</td>
      <td>${item.stock_status === 'out' ? badge('Out of stock', 'danger') : item.stock_status === 'low' ? badge(`Low (≤ ${item.reorder_level})`, 'warning') : badge('Healthy', 'success')}</td>
      <td>${fmtDate(item.nearest_expiry)}</td>
      <td>${actionButtons('medicine', item.id)}</td>
    </tr>`);
}
function renderPurchases() {
  renderSimpleRows($('#purchasesTable'), state.purchases, 9, (item) => `
    <tr>
      <td>${fmtDate(item.purchased_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${fmtDate(item.expiry_date)}</td>
      <td>${fmtCurrency(item.cost_price)}</td>
      <td>${fmtCurrency(item.mrp)}</td>
      <td>${item.quantity_purchased}</td>
      <td>${item.quantity_available}</td>
      <td>${actionButtons('purchase', item.id)}</td>
    </tr>`);
}
function renderSales() {
  renderSimpleRows($('#salesTable'), state.sales, 7, (item) => `
    <tr>
      <td>${fmtDate(item.sold_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${item.quantity_sold}</td>
      <td>${fmtCurrency(item.sale_value)}</td>
      <td>${fmtCurrency(item.profit)}</td>
      <td>${actionButtons('sale', item.id)}</td>
    </tr>`);
}
function renderWriteoffs() {
  renderSimpleRows($('#writeoffsTable'), state.writeoffs, 7, (item) => `
    <tr>
      <td>${fmtDate(item.discarded_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${item.quantity_discarded}</td>
      <td>${fmtCurrency(item.loss_value)}</td>
      <td>${actionButtons('writeoff', item.id)}</td>
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

async function promptEditManufacturer(id) {
  const item = state.manufacturers.find((x) => x.id === id);
  if (!item) return;
  const name = prompt('Manufacturer name', item.name);
  if (name === null) return;
  await api(`/api/manufacturers/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
}
async function promptEditMedicine(id) {
  const item = state.medicines.find((x) => x.id === id);
  if (!item) return;
  const manufacturerId = prompt(`Manufacturer ID\n${state.manufacturers.map((m) => `${m.id}: ${m.name}`).join('\n')}`, item.manufacturer_id);
  if (manufacturerId === null) return;
  const name = prompt('Medicine name', item.name);
  if (name === null) return;
  const strength = prompt('Strength', item.strength || '');
  if (strength === null) return;
  const form = prompt('Form', item.form || '');
  if (form === null) return;
  const reorderLevel = prompt('Reorder level', item.reorder_level);
  if (reorderLevel === null) return;
  await api(`/api/medicines/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ manufacturer_id: Number(manufacturerId), name: name.trim(), strength: strength.trim(), form: form.trim(), reorder_level: Number(reorderLevel) })
  });
}
async function promptEditPurchase(id) {
  const item = state.purchases.find((x) => x.id === id);
  if (!item) return;
  const medicineId = prompt(`Medicine ID\n${state.medicines.map((m) => `${m.id}: ${fullMedicineName(m)} — ${m.manufacturer_name}`).join('\n')}`, item.medicine_id);
  if (medicineId === null) return;
  const batchNumber = prompt('Batch number', item.batch_number);
  if (batchNumber === null) return;
  const expiryDate = prompt('Expiry date (YYYY-MM-DD)', item.expiry_date);
  if (expiryDate === null) return;
  const purchasedOn = prompt('Purchased on (YYYY-MM-DD)', item.purchased_on);
  if (purchasedOn === null) return;
  const costPrice = prompt('Cost price', item.cost_price);
  if (costPrice === null) return;
  const mrp = prompt('MRP', item.mrp);
  if (mrp === null) return;
  const quantityPurchased = prompt('Total purchased quantity', item.quantity_purchased);
  if (quantityPurchased === null) return;
  await api(`/api/purchases/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      medicine_id: Number(medicineId),
      batch_number: batchNumber.trim(),
      expiry_date: expiryDate.trim(),
      purchased_on: purchasedOn.trim(),
      cost_price: Number(costPrice),
      mrp: Number(mrp),
      quantity_purchased: Number(quantityPurchased)
    })
  });
}
async function promptEditSale(id) {
  const item = state.sales.find((x) => x.id === id);
  if (!item) return;
  const medicineId = prompt(`Medicine ID\n${state.medicines.map((m) => `${m.id}: ${fullMedicineName(m)} — ${m.manufacturer_name}`).join('\n')}`, item.medicine_id);
  if (medicineId === null) return;
  const batchInfo = await api(`/api/medicines/${Number(medicineId)}/sale-options`);
  const batchId = prompt(`Batch ID\n${batchInfo.batches.filter((b) => !b.is_expired).map((b) => `${b.id}: ${b.batch_number} | exp ${b.expiry_date} | stock ${b.quantity_available}`).join('\n')}`, item.batch_id);
  if (batchId === null) return;
  const soldOn = prompt('Sold on (YYYY-MM-DD)', item.sold_on);
  if (soldOn === null) return;
  const quantitySold = prompt('Units sold', item.quantity_sold);
  if (quantitySold === null) return;
  await api(`/api/sales/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ medicine_id: Number(medicineId), batch_id: Number(batchId), sold_on: soldOn.trim(), quantity_sold: Number(quantitySold) })
  });
}
async function promptEditWriteoff(id) {
  const item = state.writeoffs.find((x) => x.id === id);
  if (!item) return;
  const medicineId = prompt(`Medicine ID\n${state.medicines.map((m) => `${m.id}: ${fullMedicineName(m)} — ${m.manufacturer_name}`).join('\n')}`, item.medicine_id);
  if (medicineId === null) return;
  const batchInfo = await api(`/api/medicines/${Number(medicineId)}/discard-options`);
  const batchId = prompt(`Batch ID\n${batchInfo.batches.map((b) => `${b.id}: ${b.batch_number} | exp ${b.expiry_date} | stock ${b.quantity_available}`).join('\n')}`, item.batch_id);
  if (batchId === null) return;
  const discardedOn = prompt('Discarded on (YYYY-MM-DD)', item.discarded_on);
  if (discardedOn === null) return;
  const quantityDiscarded = prompt('Units discarded', item.quantity_discarded);
  if (quantityDiscarded === null) return;
  const reason = prompt('Reason', item.reason);
  if (reason === null) return;
  const notes = prompt('Notes', item.notes || '');
  if (notes === null) return;
  await api(`/api/write-offs/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ medicine_id: Number(medicineId), batch_id: Number(batchId), discarded_on: discardedOn.trim(), quantity_discarded: Number(quantityDiscarded), reason: reason.trim(), notes: notes.trim() })
  });
}
async function deleteEntity(kind, id) {
  const messages = {
    manufacturer: 'Delete this manufacturer? This will fail if medicines are linked.',
    medicine: 'Delete this medicine from master data? This will fail if purchases, sales or write-offs are linked.',
    purchase: 'Delete this purchase batch? This will fail if sales or write-offs are linked.',
    sale: 'Delete this sale entry and restore stock back to the batch?',
    writeoff: 'Delete this write-off entry and restore stock back to the batch?'
  };
  if (!confirm(messages[kind] || 'Are you sure?')) return;
  const paths = {
    manufacturer: `/api/manufacturers/${id}`,
    medicine: `/api/medicines/${id}`,
    purchase: `/api/purchases/${id}`,
    sale: `/api/sales/${id}`,
    writeoff: `/api/write-offs/${id}`
  };
  await api(paths[kind], { method: 'DELETE' });
}

function bootNavigation() {
  document.querySelectorAll('[data-page-link]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault();
    setPage(btn.dataset.pageLink);
  }));
}
function bootTableActions() {
  document.body.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    try {
      if (action === 'edit-manufacturer') await promptEditManufacturer(id);
      if (action === 'edit-medicine') await promptEditMedicine(id);
      if (action === 'edit-purchase') await promptEditPurchase(id);
      if (action === 'edit-sale') await promptEditSale(id);
      if (action === 'edit-writeoff') await promptEditWriteoff(id);
      if (action === 'delete-manufacturer') await deleteEntity('manufacturer', id);
      if (action === 'delete-medicine') await deleteEntity('medicine', id);
      if (action === 'delete-purchase') await deleteEntity('purchase', id);
      if (action === 'delete-sale') await deleteEntity('sale', id);
      if (action === 'delete-writeoff') await deleteEntity('writeoff', id);
      if (action.startsWith('edit-') || action.startsWith('delete-')) {
        await refreshAll();
        showToast('Changes saved instantly across the app.');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

async function init() {
  $('#topbarDate').textContent = new Date().toLocaleString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#purchaseForm [name="purchased_on"]').value = today;
  $('#saleForm [name="sold_on"]').value = today;
  $('#writeoffForm [name="discarded_on"]').value = today;

  bootNavigation();
  bootTableActions();
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
