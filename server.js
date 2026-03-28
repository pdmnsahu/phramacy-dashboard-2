const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'pharmacy.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isoDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
function startOfMonth(date = new Date()) {
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}
function endOfMonth(date = new Date()) {
  return isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}
function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
function previousMonthRange() {
  const now = new Date();
  const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastPrevMonth = new Date(firstThisMonth.getTime() - 86400000);
  return { from: startOfMonth(lastPrevMonth), to: endOfMonth(lastPrevMonth) };
}
function previousWeekRange() {
  const thisWeekStart = startOfWeek(new Date());
  return { from: addDays(thisWeekStart, -7), to: addDays(thisWeekStart, -1) };
}
function reportRangePresets() {
  const today = isoDate();
  return {
    today: { from: today, to: today },
    last7: { from: addDays(today, -6), to: today },
    last30: { from: addDays(today, -29), to: today },
    monthToDate: { from: startOfMonth(new Date()), to: today },
    lastWeek: previousWeekRange(),
    lastMonth: previousMonthRange()
  };
}
function badRequest(res, message, code = 400) {
  return res.status(code).json({ error: message });
}
function parsePositiveNumber(value, label) {
  const num = Number(value);
  if (!(num > 0)) throw new Error(`${label} must be greater than zero.`);
  return num;
}
function parseNonNegativeInt(value, label) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw new Error(`${label} must be a non-negative integer.`);
  return num;
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manufacturers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manufacturer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      strength TEXT DEFAULT '',
      form TEXT DEFAULT '',
      reorder_level INTEGER NOT NULL DEFAULT 20,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, strength, form, manufacturer_id),
      FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL,
      batch_number TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      cost_price REAL NOT NULL,
      mrp REAL NOT NULL,
      quantity_purchased INTEGER NOT NULL,
      quantity_available INTEGER NOT NULL,
      purchased_on TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(medicine_id, batch_number),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      quantity_sold INTEGER NOT NULL,
      sold_on TEXT NOT NULL,
      unit_sale_price REAL NOT NULL,
      unit_cost_price REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id),
      FOREIGN KEY (batch_id) REFERENCES purchase_batches(id)
    );

    CREATE TABLE IF NOT EXISTS write_offs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      quantity_discarded INTEGER NOT NULL,
      discarded_on TEXT NOT NULL,
      reason TEXT NOT NULL,
      notes TEXT DEFAULT '',
      unit_cost_price REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id),
      FOREIGN KEY (batch_id) REFERENCES purchase_batches(id)
    );
  `);

  const medicineColumns = db.prepare(`PRAGMA table_info(medicines)`).all();
  if (!medicineColumns.some((c) => c.name === 'reorder_level')) {
    db.exec(`ALTER TABLE medicines ADD COLUMN reorder_level INTEGER NOT NULL DEFAULT 20`);
  }

  const manufacturerCount = db.prepare('SELECT COUNT(*) AS count FROM manufacturers').get().count;
  if (manufacturerCount === 0) {
    const addManufacturer = db.prepare('INSERT INTO manufacturers (name) VALUES (?)');
    const addMedicine = db.prepare(`INSERT INTO medicines (manufacturer_id, name, strength, form, reorder_level) VALUES (?, ?, ?, ?, ?)`);
    const addBatch = db.prepare(`
      INSERT INTO purchase_batches
      (medicine_id, batch_number, expiry_date, cost_price, mrp, quantity_purchased, quantity_available, purchased_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const cipla = addManufacturer.run('Cipla').lastInsertRowid;
    const sun = addManufacturer.run('Sun Pharma').lastInsertRowid;
    const drReddy = addManufacturer.run("Dr. Reddy's").lastInsertRowid;

    const paracetamol = addMedicine.run(cipla, 'Paracetamol', '500 mg', 'Tablet', 40).lastInsertRowid;
    const azi = addMedicine.run(sun, 'Azithromycin', '250 mg', 'Tablet', 15).lastInsertRowid;
    const panto = addMedicine.run(drReddy, 'Pantoprazole', '40 mg', 'Tablet', 25).lastInsertRowid;

    addBatch.run(paracetamol, 'PCM-2401', daysFromNow(22), 1.8, 3.5, 120, 120, isoDate());
    addBatch.run(paracetamol, 'PCM-2402', daysFromNow(180), 2.0, 3.8, 160, 160, isoDate());
    addBatch.run(azi, 'AZI-919', daysFromNow(8), 12.5, 18.0, 18, 18, isoDate());
    addBatch.run(panto, 'PAN-780', daysFromNow(-4), 3.4, 6.5, 20, 20, isoDate());
  }
}
initDb();

function medicineRowSelect() {
  return `
    m.id,
    m.name,
    m.strength,
    m.form,
    m.reorder_level,
    m.manufacturer_id,
    mf.name AS manufacturer_name,
    COALESCE(SUM(pb.quantity_available), 0) AS total_stock,
    MIN(CASE WHEN pb.quantity_available > 0 THEN pb.expiry_date END) AS nearest_expiry,
    COUNT(DISTINCT pb.id) AS batch_count,
    CASE
      WHEN COALESCE(SUM(pb.quantity_available), 0) = 0 THEN 'out'
      WHEN COALESCE(SUM(pb.quantity_available), 0) <= m.reorder_level THEN 'low'
      ELSE 'ok'
    END AS stock_status
  `;
}
function getMedicineRow(id) {
  return db.prepare(`
    SELECT ${medicineRowSelect()}
    FROM medicines m
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN purchase_batches pb ON pb.medicine_id = m.id
    WHERE m.id = ?
    GROUP BY m.id
  `).get(id);
}
function getKpi(from, to) {
  return db.prepare(`
    SELECT
      COALESCE(ROUND(SUM(quantity_sold * unit_sale_price), 2), 0) AS sales_amount,
      COALESCE(ROUND(SUM(quantity_sold * unit_cost_price), 2), 0) AS cogs,
      COALESCE(ROUND(SUM(quantity_sold * (unit_sale_price - unit_cost_price)), 2), 0) AS gross_profit,
      COALESCE(SUM(quantity_sold), 0) AS units_sold,
      COALESCE(COUNT(*), 0) AS sale_entries
    FROM sales
    WHERE sold_on BETWEEN ? AND ?
  `).get(from, to);
}
function getManufacturerUsage(id) {
  return db.prepare(`SELECT COUNT(*) AS medicine_count FROM medicines WHERE manufacturer_id = ?`).get(id);
}
function getMedicineUsage(id) {
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM purchase_batches WHERE medicine_id = ?) AS purchase_count,
      (SELECT COUNT(*) FROM sales WHERE medicine_id = ?) AS sale_count,
      (SELECT COUNT(*) FROM write_offs WHERE medicine_id = ?) AS writeoff_count
  `).get(id, id, id);
}
function getBatchUsage(id) {
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sales WHERE batch_id = ?) AS sale_count,
      (SELECT COUNT(*) FROM write_offs WHERE batch_id = ?) AS writeoff_count
  `).get(id, id);
}
function getBatch(id) {
  return db.prepare('SELECT * FROM purchase_batches WHERE id = ?').get(id);
}
function getSale(id) {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
}
function getWriteoff(id) {
  return db.prepare('SELECT * FROM write_offs WHERE id = ?').get(id);
}
function validateBatchForMedicine(batchId, medicineId) {
  const batch = db.prepare('SELECT * FROM purchase_batches WHERE id = ? AND medicine_id = ?').get(batchId, medicineId);
  if (!batch) throw new Error('Selected batch not found for the selected medicine.');
  return batch;
}
function ensureManufacturerExists(id) {
  const row = db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(id);
  if (!row) throw new Error('Selected manufacturer does not exist.');
  return row;
}
function ensureMedicineExists(id) {
  const row = db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!row) throw new Error('Selected medicine does not exist.');
  return row;
}
function checkNoBatchDependencies(batchId, actionLabel) {
  const usage = getBatchUsage(batchId);
  if (usage.sale_count > 0 || usage.writeoff_count > 0) {
    throw new Error(`Cannot ${actionLabel} this purchase batch because sales or write-offs are already linked to it.`);
  }
}

app.get('/api/manufacturers', (req, res) => {
  res.json(db.prepare('SELECT * FROM manufacturers ORDER BY name').all());
});

app.post('/api/manufacturers', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return badRequest(res, 'Manufacturer name is required.');
  try {
    const info = db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(name);
    res.status(201).json(db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'Manufacturer already exists.' });
  }
});

app.put('/api/manufacturers/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  if (!id || !name) return badRequest(res, 'Manufacturer id and name are required.');
  if (!db.prepare('SELECT 1 FROM manufacturers WHERE id = ?').get(id)) return badRequest(res, 'Manufacturer not found.', 404);
  try {
    db.prepare('UPDATE manufacturers SET name = ? WHERE id = ?').run(name, id);
    res.json(db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(id));
  } catch {
    res.status(400).json({ error: 'Manufacturer already exists.' });
  }
});

app.delete('/api/manufacturers/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Manufacturer id is required.');
  const manufacturer = db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(id);
  if (!manufacturer) return badRequest(res, 'Manufacturer not found.', 404);
  const usage = getManufacturerUsage(id);
  if (usage.medicine_count > 0) {
    return badRequest(res, 'Cannot delete this manufacturer because medicines are linked to it.');
  }
  db.prepare('DELETE FROM manufacturers WHERE id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/medicines', (req, res) => {
  const rows = db.prepare(`
    SELECT ${medicineRowSelect()}
    FROM medicines m
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN purchase_batches pb ON pb.medicine_id = m.id
    GROUP BY m.id
    ORDER BY m.name, mf.name
  `).all();
  res.json(rows);
});

app.post('/api/medicines', (req, res) => {
  const manufacturerId = Number(req.body.manufacturer_id);
  const name = String(req.body.name || '').trim();
  const strength = String(req.body.strength || '').trim();
  const form = String(req.body.form || '').trim();
  const reorderLevel = Number(req.body.reorder_level || 20);

  if (!manufacturerId || !name) return badRequest(res, 'Manufacturer and medicine name are required.');
  if (reorderLevel < 0) return badRequest(res, 'Reorder level cannot be negative.');

  try {
    ensureManufacturerExists(manufacturerId);
    const info = db.prepare(`
      INSERT INTO medicines (manufacturer_id, name, strength, form, reorder_level)
      VALUES (?, ?, ?, ?, ?)
    `).run(manufacturerId, name, strength, form, reorderLevel);
    res.status(201).json(getMedicineRow(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: err.message === 'Selected manufacturer does not exist.' ? err.message : 'Medicine already exists for this manufacturer.' });
  }
});

app.put('/api/medicines/:id', (req, res) => {
  const id = Number(req.params.id);
  const manufacturerId = Number(req.body.manufacturer_id);
  const name = String(req.body.name || '').trim();
  const strength = String(req.body.strength || '').trim();
  const form = String(req.body.form || '').trim();
  const reorderLevel = Number(req.body.reorder_level);
  if (!id || !manufacturerId || !name) return badRequest(res, 'Manufacturer and medicine name are required.');
  if (!(reorderLevel >= 0)) return badRequest(res, 'Reorder level cannot be negative.');
  if (!db.prepare('SELECT 1 FROM medicines WHERE id = ?').get(id)) return badRequest(res, 'Medicine not found.', 404);
  try {
    ensureManufacturerExists(manufacturerId);
    db.prepare(`
      UPDATE medicines
      SET manufacturer_id = ?, name = ?, strength = ?, form = ?, reorder_level = ?
      WHERE id = ?
    `).run(manufacturerId, name, strength, form, reorderLevel, id);
    res.json(getMedicineRow(id));
  } catch (err) {
    res.status(400).json({ error: err.message === 'Selected manufacturer does not exist.' ? err.message : 'Another medicine with the same details already exists for that manufacturer.' });
  }
});

app.delete('/api/medicines/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Medicine id is required.');
  const medicine = db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!medicine) return badRequest(res, 'Medicine not found.', 404);
  const usage = getMedicineUsage(id);
  if (usage.purchase_count > 0 || usage.sale_count > 0 || usage.writeoff_count > 0) {
    return badRequest(res, 'Cannot delete this medicine from master data because purchases, sales, or write-offs are linked to it.');
  }
  db.prepare('DELETE FROM medicines WHERE id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/batches', (req, res) => {
  const medicineId = Number(req.query.medicine_id || 0);
  let sql = `
    SELECT pb.*, m.name AS medicine_name, m.strength, m.form, mf.name AS manufacturer_name,
           CASE WHEN pb.expiry_date < date('now') THEN 1 ELSE 0 END AS is_expired,
           CASE WHEN pb.expiry_date <= date('now', '+30 day') AND pb.expiry_date >= date('now') THEN 1 ELSE 0 END AS is_near_expiry
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
  `;
  const params = [];
  if (medicineId) {
    sql += ' WHERE pb.medicine_id = ?';
    params.push(medicineId);
  }
  sql += ' ORDER BY pb.expiry_date ASC, pb.created_at ASC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/medicines/:id/sale-options', (req, res) => {
  const medicineId = Number(req.params.id);
  const batches = db.prepare(`
    SELECT id, batch_number, expiry_date, cost_price, mrp, quantity_available,
           CASE WHEN expiry_date < date('now') THEN 1 ELSE 0 END AS is_expired
    FROM purchase_batches
    WHERE medicine_id = ? AND quantity_available > 0
    ORDER BY (CASE WHEN expiry_date < date('now') THEN 1 ELSE 0 END) ASC, expiry_date ASC, created_at ASC
  `).all(medicineId);
  const sellable = batches.filter((b) => !b.is_expired);
  res.json({
    default_batch_id: sellable[0]?.id || batches[0]?.id || null,
    batches
  });
});

app.get('/api/medicines/:id/discard-options', (req, res) => {
  const medicineId = Number(req.params.id);
  const batches = db.prepare(`
    SELECT id, batch_number, expiry_date, cost_price, mrp, quantity_available,
           CASE WHEN expiry_date < date('now') THEN 1 ELSE 0 END AS is_expired
    FROM purchase_batches
    WHERE medicine_id = ? AND quantity_available > 0
    ORDER BY expiry_date ASC, created_at ASC
  `).all(medicineId);
  res.json({
    default_batch_id: batches[0]?.id || null,
    batches
  });
});

app.post('/api/purchases', (req, res) => {
  try {
    const medicineId = Number(req.body.medicine_id);
    const batchNumber = String(req.body.batch_number || '').trim();
    const expiryDate = String(req.body.expiry_date || '').trim();
    const purchasedOn = String(req.body.purchased_on || isoDate()).trim();
    const costPrice = parsePositiveNumber(req.body.cost_price, 'Cost price');
    const mrp = parsePositiveNumber(req.body.mrp, 'MRP');
    const quantity = parseNonNegativeInt(req.body.quantity_purchased, 'Purchased quantity');

    if (!medicineId || !batchNumber || !expiryDate || quantity <= 0) {
      return badRequest(res, 'All purchase fields are required with valid positive values.');
    }
    ensureMedicineExists(medicineId);
    const info = db.prepare(`
      INSERT INTO purchase_batches
      (medicine_id, batch_number, expiry_date, cost_price, mrp, quantity_purchased, quantity_available, purchased_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(medicineId, batchNumber, expiryDate, costPrice, mrp, quantity, quantity, purchasedOn);
    res.status(201).json(db.prepare('SELECT * FROM purchase_batches WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: err.message.includes('does not exist') ? err.message : err.message || 'This batch number already exists for the selected medicine.' });
  }
});

app.put('/api/purchases/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Purchase id is required.');
  const existing = getBatch(id);
  if (!existing) return badRequest(res, 'Purchase entry not found.', 404);
  try {
    checkNoBatchDependencies(id, 'edit');
    const medicineId = Number(req.body.medicine_id);
    const batchNumber = String(req.body.batch_number || '').trim();
    const expiryDate = String(req.body.expiry_date || '').trim();
    const purchasedOn = String(req.body.purchased_on || isoDate()).trim();
    const costPrice = parsePositiveNumber(req.body.cost_price, 'Cost price');
    const mrp = parsePositiveNumber(req.body.mrp, 'MRP');
    const quantity = parseNonNegativeInt(req.body.quantity_purchased, 'Purchased quantity');

    if (!medicineId || !batchNumber || !expiryDate || quantity <= 0) {
      return badRequest(res, 'All purchase fields are required with valid positive values.');
    }
    ensureMedicineExists(medicineId);
    db.prepare(`
      UPDATE purchase_batches
      SET medicine_id = ?, batch_number = ?, expiry_date = ?, cost_price = ?, mrp = ?, quantity_purchased = ?, quantity_available = ?, purchased_on = ?
      WHERE id = ?
    `).run(medicineId, batchNumber, expiryDate, costPrice, mrp, quantity, quantity, purchasedOn, id);
    res.json(getBatch(id));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to update purchase entry.' });
  }
});

app.delete('/api/purchases/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Purchase id is required.');
  const batch = getBatch(id);
  if (!batch) return badRequest(res, 'Purchase entry not found.', 404);
  try {
    checkNoBatchDependencies(id, 'delete');
    db.prepare('DELETE FROM purchase_batches WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/purchases', (req, res) => {
  res.json(db.prepare(`
    SELECT pb.*, m.name AS medicine_name, m.strength, m.form, mf.name AS manufacturer_name
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY pb.purchased_on DESC, pb.created_at DESC
  `).all());
});

app.post('/api/sales', (req, res) => {
  try {
    const medicineId = Number(req.body.medicine_id);
    const batchId = Number(req.body.batch_id);
    const quantitySold = parseNonNegativeInt(req.body.quantity_sold, 'Sold quantity');
    const soldOn = String(req.body.sold_on || isoDate()).trim();

    if (!medicineId || !batchId || quantitySold <= 0) {
      return badRequest(res, 'Medicine, batch and quantity are required.');
    }
    const batch = validateBatchForMedicine(batchId, medicineId);
    if (batch.expiry_date < isoDate()) return badRequest(res, 'Expired batch cannot be sold.');
    if (batch.quantity_available < quantitySold) return badRequest(res, 'Not enough stock in selected batch.');

    const tx = db.transaction(() => {
      db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available - ? WHERE id = ?').run(quantitySold, batchId);
      const sale = db.prepare(`
        INSERT INTO sales (medicine_id, batch_id, quantity_sold, sold_on, unit_sale_price, unit_cost_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(medicineId, batchId, quantitySold, soldOn, batch.mrp, batch.cost_price);
      return getSale(sale.lastInsertRowid);
    });

    res.status(201).json(tx());
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to save sale.' });
  }
});

app.put('/api/sales/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Sale id is required.');
  const existing = getSale(id);
  if (!existing) return badRequest(res, 'Sale entry not found.', 404);
  try {
    const medicineId = Number(req.body.medicine_id);
    const batchId = Number(req.body.batch_id);
    const quantitySold = parseNonNegativeInt(req.body.quantity_sold, 'Sold quantity');
    const soldOn = String(req.body.sold_on || isoDate()).trim();
    if (!medicineId || !batchId || quantitySold <= 0) {
      return badRequest(res, 'Medicine, batch and quantity are required.');
    }

    const tx = db.transaction(() => {
      db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available + ? WHERE id = ?').run(existing.quantity_sold, existing.batch_id);
      const newBatch = validateBatchForMedicine(batchId, medicineId);
      if (newBatch.expiry_date < isoDate()) throw new Error('Expired batch cannot be sold.');
      if (newBatch.quantity_available < quantitySold) throw new Error('Not enough stock in selected batch.');
      db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available - ? WHERE id = ?').run(quantitySold, batchId);
      db.prepare(`
        UPDATE sales
        SET medicine_id = ?, batch_id = ?, quantity_sold = ?, sold_on = ?, unit_sale_price = ?, unit_cost_price = ?
        WHERE id = ?
      `).run(medicineId, batchId, quantitySold, soldOn, newBatch.mrp, newBatch.cost_price, id);
      return getSale(id);
    });

    res.json(tx());
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to update sale.' });
  }
});

app.delete('/api/sales/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Sale id is required.');
  const sale = getSale(id);
  if (!sale) return badRequest(res, 'Sale entry not found.', 404);
  const tx = db.transaction(() => {
    db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available + ? WHERE id = ?').run(sale.quantity_sold, sale.batch_id);
    db.prepare('DELETE FROM sales WHERE id = ?').run(id);
  });
  tx();
  res.json({ success: true });
});

app.get('/api/sales', (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, pb.batch_number, pb.expiry_date, m.name AS medicine_name, m.strength, m.form, mf.name AS manufacturer_name,
           ROUND(s.quantity_sold * s.unit_sale_price, 2) AS sale_value,
           ROUND(s.quantity_sold * s.unit_cost_price, 2) AS cogs,
           ROUND(s.quantity_sold * (s.unit_sale_price - s.unit_cost_price), 2) AS profit
    FROM sales s
    JOIN purchase_batches pb ON pb.id = s.batch_id
    JOIN medicines m ON m.id = s.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY s.sold_on DESC, s.created_at DESC
  `).all());
});

app.post('/api/write-offs', (req, res) => {
  try {
    const medicineId = Number(req.body.medicine_id);
    const batchId = Number(req.body.batch_id);
    const quantityDiscarded = parseNonNegativeInt(req.body.quantity_discarded, 'Discard quantity');
    const discardedOn = String(req.body.discarded_on || isoDate()).trim();
    const reason = String(req.body.reason || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!medicineId || !batchId || quantityDiscarded <= 0 || !reason) {
      return badRequest(res, 'Medicine, batch, quantity and reason are required.');
    }

    const batch = validateBatchForMedicine(batchId, medicineId);
    if (batch.quantity_available < quantityDiscarded) return badRequest(res, 'Not enough available stock in selected batch.');

    const tx = db.transaction(() => {
      db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available - ? WHERE id = ?').run(quantityDiscarded, batchId);
      const info = db.prepare(`
        INSERT INTO write_offs (medicine_id, batch_id, quantity_discarded, discarded_on, reason, notes, unit_cost_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(medicineId, batchId, quantityDiscarded, discardedOn, reason, notes, batch.cost_price);
      return getWriteoff(info.lastInsertRowid);
    });

    res.status(201).json(tx());
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to save write-off.' });
  }
});

app.put('/api/write-offs/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Write-off id is required.');
  const existing = getWriteoff(id);
  if (!existing) return badRequest(res, 'Write-off entry not found.', 404);
  try {
    const medicineId = Number(req.body.medicine_id);
    const batchId = Number(req.body.batch_id);
    const quantityDiscarded = parseNonNegativeInt(req.body.quantity_discarded, 'Discard quantity');
    const discardedOn = String(req.body.discarded_on || isoDate()).trim();
    const reason = String(req.body.reason || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!medicineId || !batchId || quantityDiscarded <= 0 || !reason) {
      return badRequest(res, 'Medicine, batch, quantity and reason are required.');
    }

    const tx = db.transaction(() => {
      db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available + ? WHERE id = ?').run(existing.quantity_discarded, existing.batch_id);
      const newBatch = validateBatchForMedicine(batchId, medicineId);
      if (newBatch.quantity_available < quantityDiscarded) throw new Error('Not enough available stock in selected batch.');
      db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available - ? WHERE id = ?').run(quantityDiscarded, batchId);
      db.prepare(`
        UPDATE write_offs
        SET medicine_id = ?, batch_id = ?, quantity_discarded = ?, discarded_on = ?, reason = ?, notes = ?, unit_cost_price = ?
        WHERE id = ?
      `).run(medicineId, batchId, quantityDiscarded, discardedOn, reason, notes, newBatch.cost_price, id);
      return getWriteoff(id);
    });

    res.json(tx());
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to update write-off.' });
  }
});

app.delete('/api/write-offs/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Write-off id is required.');
  const writeoff = getWriteoff(id);
  if (!writeoff) return badRequest(res, 'Write-off entry not found.', 404);
  const tx = db.transaction(() => {
    db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available + ? WHERE id = ?').run(writeoff.quantity_discarded, writeoff.batch_id);
    db.prepare('DELETE FROM write_offs WHERE id = ?').run(id);
  });
  tx();
  res.json({ success: true });
});

app.get('/api/write-offs', (req, res) => {
  res.json(db.prepare(`
    SELECT w.*, pb.batch_number, pb.expiry_date, m.name AS medicine_name, m.strength, m.form, mf.name AS manufacturer_name,
           ROUND(w.quantity_discarded * w.unit_cost_price, 2) AS loss_value
    FROM write_offs w
    JOIN purchase_batches pb ON pb.id = w.batch_id
    JOIN medicines m ON m.id = w.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY w.discarded_on DESC, w.created_at DESC
  `).all());
});

app.get('/api/dashboard', (req, res) => {
  const presets = reportRangePresets();
  const todayStats = getKpi(presets.today.from, presets.today.to);
  const lastWeekStats = getKpi(presets.lastWeek.from, presets.lastWeek.to);
  const lastMonthStats = getKpi(presets.lastMonth.from, presets.lastMonth.to);
  const last30Stats = getKpi(presets.last30.from, presets.last30.to);

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM medicines) AS total_medicines,
      (SELECT COUNT(*) FROM manufacturers) AS total_manufacturers,
      (SELECT COALESCE(SUM(quantity_available), 0) FROM purchase_batches) AS total_units,
      (SELECT COUNT(*) FROM medicines m WHERE COALESCE((SELECT SUM(quantity_available) FROM purchase_batches WHERE medicine_id = m.id),0) = 0) AS out_of_stock_medicines,
      (SELECT COUNT(*) FROM medicines m WHERE COALESCE((SELECT SUM(quantity_available) FROM purchase_batches WHERE medicine_id = m.id),0) BETWEEN 1 AND m.reorder_level) AS low_stock_medicines,
      (SELECT COUNT(*) FROM purchase_batches WHERE quantity_available > 0 AND expiry_date < date('now')) AS expired_batches,
      (SELECT COUNT(*) FROM purchase_batches WHERE quantity_available > 0 AND expiry_date BETWEEN date('now') AND date('now', '+30 day')) AS near_expiry_batches,
      (SELECT COALESCE(ROUND(SUM(quantity_available * cost_price), 2), 0) FROM purchase_batches) AS current_stock_value,
      (SELECT COALESCE(ROUND(SUM(quantity_available * mrp), 2), 0) FROM purchase_batches) AS current_stock_mrp_value,
      (SELECT COALESCE(ROUND(SUM(quantity_available * cost_price), 2), 0) FROM purchase_batches WHERE quantity_available > 0 AND expiry_date < date('now')) AS expired_stock_value,
      (SELECT COALESCE(ROUND(SUM(quantity_available * cost_price), 2), 0) FROM purchase_batches WHERE quantity_available > 0 AND expiry_date BETWEEN date('now') AND date('now', '+30 day')) AS near_expiry_stock_value,
      (SELECT COALESCE(ROUND(SUM(quantity_discarded * unit_cost_price), 2), 0) FROM write_offs WHERE discarded_on = date('now')) AS today_writeoff_loss,
      (SELECT COALESCE(ROUND(SUM(quantity_discarded * unit_cost_price), 2), 0) FROM write_offs) AS lifetime_writeoff_loss
  `).get();

  const lowStock = db.prepare(`
    SELECT m.id, m.name, m.strength, m.form, m.reorder_level, mf.name AS manufacturer_name,
           COALESCE(SUM(pb.quantity_available), 0) AS total_stock
    FROM medicines m
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN purchase_batches pb ON pb.medicine_id = m.id
    GROUP BY m.id
    HAVING total_stock BETWEEN 1 AND m.reorder_level
    ORDER BY total_stock ASC, m.name ASC
    LIMIT 8
  `).all();

  const nearExpiry = db.prepare(`
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity_available,
           m.name AS medicine_name, mf.name AS manufacturer_name
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    WHERE pb.quantity_available > 0 AND pb.expiry_date BETWEEN date('now') AND date('now', '+30 day')
    ORDER BY pb.expiry_date ASC
    LIMIT 8
  `).all();

  const expiredBatches = db.prepare(`
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity_available, pb.cost_price,
           m.name AS medicine_name, mf.name AS manufacturer_name,
           ROUND(pb.quantity_available * pb.cost_price, 2) AS loss_value
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    WHERE pb.quantity_available > 0 AND pb.expiry_date < date('now')
    ORDER BY pb.expiry_date ASC
    LIMIT 8
  `).all();

  const recentWriteOffs = db.prepare(`
    SELECT w.id, w.discarded_on, w.reason, w.quantity_discarded,
           pb.batch_number, m.name AS medicine_name,
           ROUND(w.quantity_discarded * w.unit_cost_price, 2) AS loss_value
    FROM write_offs w
    JOIN purchase_batches pb ON pb.id = w.batch_id
    JOIN medicines m ON m.id = w.medicine_id
    ORDER BY w.created_at DESC
    LIMIT 5
  `).all();

  const topMedicines = db.prepare(`
    SELECT m.name AS medicine_name,
           SUM(s.quantity_sold) AS units_sold,
           ROUND(SUM(s.quantity_sold * (s.unit_sale_price - s.unit_cost_price)), 2) AS profit
    FROM sales s
    JOIN medicines m ON m.id = s.medicine_id
    WHERE s.sold_on BETWEEN ? AND ?
    GROUP BY s.medicine_id
    ORDER BY units_sold DESC, profit DESC
    LIMIT 5
  `).all(presets.last30.from, presets.last30.to);

  res.json({
    summary: {
      ...summary,
      today_sales: todayStats.sales_amount,
      today_profit: todayStats.gross_profit,
      today_units: todayStats.units_sold,
      last_week_profit: lastWeekStats.gross_profit,
      last_month_profit: lastMonthStats.gross_profit,
      last_30_days_profit: last30Stats.gross_profit
    },
    lowStock,
    nearExpiry,
    expiredBatches,
    recentWriteOffs,
    topMedicines,
    presets
  });
});

app.get('/api/reports/profit', (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (!from || !to) return badRequest(res, 'From and to dates are required.');
  if (from > to) return badRequest(res, 'From date cannot be after to date.');

  const summary = getKpi(from, to);
  const byMedicine = db.prepare(`
    SELECT m.name AS medicine_name, mf.name AS manufacturer_name,
           SUM(s.quantity_sold) AS units_sold,
           ROUND(SUM(s.quantity_sold * s.unit_sale_price), 2) AS sales_amount,
           ROUND(SUM(s.quantity_sold * s.unit_cost_price), 2) AS cogs,
           ROUND(SUM(s.quantity_sold * (s.unit_sale_price - s.unit_cost_price)), 2) AS gross_profit
    FROM sales s
    JOIN medicines m ON m.id = s.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    WHERE s.sold_on BETWEEN ? AND ?
    GROUP BY s.medicine_id
    ORDER BY gross_profit DESC, sales_amount DESC
    LIMIT 12
  `).all(from, to);

  const daily = db.prepare(`
    SELECT sold_on,
           ROUND(SUM(quantity_sold * unit_sale_price), 2) AS sales_amount,
           ROUND(SUM(quantity_sold * unit_cost_price), 2) AS cogs,
           ROUND(SUM(quantity_sold * (unit_sale_price - unit_cost_price)), 2) AS gross_profit,
           SUM(quantity_sold) AS units_sold
    FROM sales
    WHERE sold_on BETWEEN ? AND ?
    GROUP BY sold_on
    ORDER BY sold_on DESC
    LIMIT 31
  `).all(from, to);

  const writeOffLoss = db.prepare(`
    SELECT COALESCE(ROUND(SUM(quantity_discarded * unit_cost_price), 2), 0) AS loss_value
    FROM write_offs
    WHERE discarded_on BETWEEN ? AND ?
  `).get(from, to).loss_value;

  res.json({ from, to, summary: { ...summary, writeoff_loss: writeOffLoss }, byMedicine, daily });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`MediStock Pro running on http://localhost:${port}`);
});
