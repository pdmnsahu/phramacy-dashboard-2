const state = {
  manufacturers: [],
  medicines: [],
  purchases: [],
  sales: [],
  currentPage: 'dashboard'
};

const $ = (sel) => document.querySelector(sel);
const fmtCurrency = (n) => `₹${Number(n || 0).toFixed(2)}`;
const fmtDate = (value) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const today = new Date().toISOString().slice(0, 10);

function showToast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.style.background = isError ? '#b91c1c' : '#0f172a';
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('[data-page-link]').forEach(el => el.classList.remove('active'));
  $(`#page-${page}`).classList.add('active');
  document.querySelectorAll(`[data-page-link="${page}"]`).forEach(el => el.classList.add('active'));
  $('#pageTitle').textContent = page[0].toUpperCase() + page.slice(1);
  if (page === 'dashboard') loadDashboard();
}

async function refreshLookups() {
  state.manufacturers = await api('/api/manufacturers');
  state.medicines = await api('/api/medicines');
  renderManufacturers();
  renderMedicines();
  fillManufacturerSelects();
  fillMedicineSelects();
}

async function refreshTransactions() {
  state.purchases = await api('/api/purchases');
  state.sales = await api('/api/sales');
  renderPurchases();
  renderSales();
}

async function refreshAll() {
  await refreshLookups();
  await refreshTransactions();
  await loadDashboard();
  if ($('#saleMedicine').value) await updateSaleBatchOptions();
}

function fillManufacturerSelects() {
  const options = ['<option value="">Select manufacturer</option>']
    .concat(state.manufacturers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`))
    .join('');
  $('#medicineManufacturer').innerHTML = options;
}

function fillMedicineSelects() {
  const options = ['<option value="">Select medicine</option>']
    .concat(state.medicines.map(item => `<option value="${item.id}">${escapeHtml(fullMedicineName(item))} — ${escapeHtml(item.manufacturer_name)}</option>`))
    .join('');
  $('#purchaseMedicine').innerHTML = options;
  $('#saleMedicine').innerHTML = options;
}

function fullMedicineName(item) {
  return [item.name, item.strength, item.form].filter(Boolean).join(' • ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderManufacturers() {
  const rows = state.manufacturers.map(item => `
    <tr><td>${escapeHtml(item.name)}</td><td>${fmtDate(item.created_at)}</td></tr>
  `).join('');
  $('#manufacturersTable').innerHTML = rows || `<tr><td colspan="2" class="empty">No manufacturers yet.</td></tr>`;
}

function renderMedicines() {
  const rows = state.medicines.map(item => `
    <tr>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.manufacturer_name)}</td>
      <td>${item.total_stock}</td>
      <td>${item.batch_count}</td>
      <td>${fmtDate(item.nearest_expiry)}</td>
    </tr>
  `).join('');
  $('#medicinesTable').innerHTML = rows || `<tr><td colspan="5" class="empty">No medicines yet.</td></tr>`;
}

function renderPurchases() {
  const rows = state.purchases.map(item => `
    <tr>
      <td>${fmtDate(item.purchased_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.manufacturer_name)}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${fmtDate(item.expiry_date)}</td>
      <td>${fmtCurrency(item.cost_price)}</td>
      <td>${fmtCurrency(item.mrp)}</td>
      <td>${item.quantity_purchased}</td>
      <td>${item.quantity_available}</td>
    </tr>
  `).join('');
  $('#purchasesTable').innerHTML = rows || `<tr><td colspan="9" class="empty">No purchases yet.</td></tr>`;
}

function renderSales() {
  const rows = state.sales.map(item => `
    <tr>
      <td>${fmtDate(item.sold_on)}</td>
      <td>${escapeHtml(fullMedicineName(item))}</td>
      <td>${escapeHtml(item.manufacturer_name)}</td>
      <td>${escapeHtml(item.batch_number)}</td>
      <td>${item.quantity_sold}</td>
      <td>${fmtCurrency(item.unit_sale_price)}</td>
      <td>${fmtCurrency(item.sale_value)}</td>
      <td>${fmtCurrency(item.profit)}</td>
    </tr>
  `).join('');
  $('#salesTable').innerHTML = rows || `<tr><td colspan="8" class="empty">No sales yet.</td></tr>`;
}

function renderSimpleRows(target, rows, cols, formatter) {
  target.innerHTML = rows.length ? rows.map(formatter).join('') : `<tr><td colspan="${cols}" class="empty">Nothing to show.</td></tr>`;
}

async function loadDashboard() {
  const data = await api('/api/dashboard');
  const s = data.summary;
  $('#statMedicines').textContent = s.total_medicines;
  $('#statManufacturers').textContent = s.total_manufacturers;
  $('#statUnits').textContent = s.total_units;
  $('#statLow').textContent = s.low_stock_medicines;
  $('#statOut').textContent = s.out_of_stock_medicines;
  $('#statNearExpiry').textContent = s.near_expiry_batches;
  $('#statExpired').textContent = s.expired_batches;
  $('#statTodaySales').textContent = fmtCurrency(s.today_sales);
  $('#statTodayProfit').textContent = fmtCurrency(s.today_profit);
  $('#statStockValue').textContent = fmtCurrency(s.current_stock_value);
  $('#statTodayUnits').textContent = `${s.today_units} units sold`;

  renderSimpleRows($('#lowStockTable'), data.lowStock, 3, item => `
    <tr><td>${escapeHtml(fullMedicineName(item))}</td><td>${escapeHtml(item.manufacturer_name)}</td><td>${item.total_stock}</td></tr>
  `);
  renderSimpleRows($('#nearExpiryTable'), data.nearExpiry, 4, item => `
    <tr><td>${escapeHtml(item.medicine_name)}</td><td>${escapeHtml(item.batch_number)}</td><td>${fmtDate(item.expiry_date)}</td><td>${item.quantity_available}</td></tr>
  `);
  renderSimpleRows($('#recentPurchasesTable'), data.recentPurchases, 4, item => `
    <tr><td>${fmtDate(item.purchased_on)}</td><td>${escapeHtml(item.medicine_name)}</td><td>${escapeHtml(item.batch_number)}</td><td>${item.quantity_purchased}</td></tr>
  `);
  renderSimpleRows($('#recentSalesTable'), data.recentSales, 4, item => `
    <tr><td>${fmtDate(item.sold_on)}</td><td>${escapeHtml(item.medicine_name)}</td><td>${escapeHtml(item.batch_number)}</td><td>${fmtCurrency(item.sale_value)}</td></tr>
  `);
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
  if (!data.batches.length) {
    saleBatch.innerHTML = '<option value="">No sellable batch available</option>';
    $('#batchHint').textContent = 'This medicine has no batch with available stock.';
    return;
  }
  saleBatch.innerHTML = data.batches.map(b => `
    <option value="${b.id}" ${b.id === data.default_batch_id ? 'selected' : ''}>
      ${escapeHtml(b.batch_number)} • exp ${b.expiry_date} • stock ${b.quantity_available} • MRP ${fmtCurrency(b.mrp)}
    </option>
  `).join('');
  const first = data.batches.find(b => b.id === data.default_batch_id) || data.batches[0];
  $('#batchHint').innerHTML = `Default batch selected: <strong>${escapeHtml(first.batch_number)}</strong>, because it expires first on <strong>${fmtDate(first.expiry_date)}</strong>.`;
}

async function handleSubmit(formId, path) {
  const form = $(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
      form.reset();
      if (formId === '#purchaseForm' || formId === '#saleForm') form.querySelector('[name$="_on"]').value = today;
      await refreshAll();
      if (formId === '#saleForm') $('#saleBatch').innerHTML = '<option value="">Select batch</option>';
      showToast('Saved successfully. Dashboard and tables updated instantly.');
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function bootNavigation() {
  document.querySelectorAll('[data-page-link]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      setPage(btn.dataset.pageLink);
    });
  });
}

async function init() {
  $('#topbarDate').textContent = new Date().toLocaleString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  $('#purchaseForm [name="purchased_on"]').value = today;
  $('#saleForm [name="sold_on"]').value = today;
  bootNavigation();
  handleSubmit('#manufacturerForm', '/api/manufacturers');
  handleSubmit('#medicineForm', '/api/medicines');
  handleSubmit('#purchaseForm', '/api/purchases');
  handleSubmit('#saleForm', '/api/sales');
  $('#saleMedicine').addEventListener('change', updateSaleBatchOptions);
  await refreshAll();
}

init().catch(err => showToast(err.message, true));
