const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const dbPath = path.join(__dirname, 'data', 'pharmacy.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  `);

  const manufacturerCount = db.prepare('SELECT COUNT(*) as count FROM manufacturers').get().count;
  if (manufacturerCount === 0) {
    const insertManufacturer = db.prepare('INSERT INTO manufacturers (name) VALUES (?)');
    const insertMedicine = db.prepare('INSERT INTO medicines (manufacturer_id, name, strength, form) VALUES (?, ?, ?, ?)');
    const insertBatch = db.prepare(`
      INSERT INTO purchase_batches
      (medicine_id, batch_number, expiry_date, cost_price, mrp, quantity_purchased, quantity_available, purchased_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const cipla = insertManufacturer.run('Cipla').lastInsertRowid;
    const sun = insertManufacturer.run('Sun Pharma').lastInsertRowid;
    const apollo = insertManufacturer.run('Apollo').lastInsertRowid;

    const med1 = insertMedicine.run(cipla, 'Paracetamol', '500 mg', 'Tablet').lastInsertRowid;
    const med2 = insertMedicine.run(sun, 'Azithromycin', '250 mg', 'Tablet').lastInsertRowid;
    const med3 = insertMedicine.run(apollo, 'Vitamin C', '1000 mg', 'Tablet').lastInsertRowid;

    insertBatch.run(med1, 'PCM-2401', futureDate(120), 1.8, 3.5, 300, 300, today());
    insertBatch.run(med1, 'PCM-2402', futureDate(240), 2.0, 3.8, 150, 150, today());
    insertBatch.run(med2, 'AZI-919', futureDate(60), 12.5, 18.0, 90, 90, today());
    insertBatch.run(med3, 'VTC-100', futureDate(25), 4.2, 8.0, 50, 50, today());
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

initDb();

function medicineRowSelect() {
  return `
    m.id,
    m.name,
    m.strength,
    m.form,
    m.manufacturer_id,
    mf.name as manufacturer_name,
    COALESCE(SUM(pb.quantity_available), 0) as total_stock,
    MIN(CASE WHEN pb.quantity_available > 0 THEN pb.expiry_date END) as nearest_expiry,
    COUNT(DISTINCT pb.id) as batch_count
  `;
}

app.get('/api/manufacturers', (req, res) => {
  const rows = db.prepare('SELECT * FROM manufacturers ORDER BY name').all();
  res.json(rows);
});

app.post('/api/manufacturers', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Manufacturer name is required.' });
  try {
    const info = db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(name);
    const row = db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: 'Manufacturer already exists.' });
  }
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
  const name = (req.body.name || '').trim();
  const strength = (req.body.strength || '').trim();
  const form = (req.body.form || '').trim();
  if (!manufacturerId || !name) return res.status(400).json({ error: 'Manufacturer and medicine name are required.' });
  try {
    const info = db.prepare(
      'INSERT INTO medicines (manufacturer_id, name, strength, form) VALUES (?, ?, ?, ?)'
    ).run(manufacturerId, name, strength, form);
    const row = db.prepare(`
      SELECT ${medicineRowSelect()}
      FROM medicines m
      JOIN manufacturers mf ON mf.id = m.manufacturer_id
      LEFT JOIN purchase_batches pb ON pb.medicine_id = m.id
      WHERE m.id = ?
      GROUP BY m.id
    `).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: 'Medicine already exists for this manufacturer.' });
  }
});

app.get('/api/batches', (req, res) => {
  const medicineId = Number(req.query.medicine_id);
  let sql = `
    SELECT pb.*, m.name as medicine_name, m.strength, m.form, mf.name as manufacturer_name
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
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.get('/api/medicines/:id/sale-options', (req, res) => {
  const medicineId = Number(req.params.id);
  const batches = db.prepare(`
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.cost_price, pb.mrp, pb.quantity_available,
           CASE WHEN pb.expiry_date < date('now') THEN 1 ELSE 0 END as is_expired
    FROM purchase_batches pb
    WHERE pb.medicine_id = ? AND pb.quantity_available > 0
    ORDER BY pb.expiry_date ASC, pb.created_at ASC
  `).all(medicineId);
  res.json({ default_batch_id: batches[0]?.id || null, batches });
});

app.post('/api/purchases', (req, res) => {
  const medicineId = Number(req.body.medicine_id);
  const batchNumber = (req.body.batch_number || '').trim();
  const expiryDate = (req.body.expiry_date || '').trim();
  const purchasedOn = (req.body.purchased_on || today()).trim();
  const costPrice = Number(req.body.cost_price);
  const mrp = Number(req.body.mrp);
  const quantity = Number(req.body.quantity_purchased);

  if (!medicineId || !batchNumber || !expiryDate || !costPrice || !mrp || !quantity) {
    return res.status(400).json({ error: 'All purchase fields are required.' });
  }
  if (quantity <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero.' });

  try {
    const info = db.prepare(`
      INSERT INTO purchase_batches
      (medicine_id, batch_number, expiry_date, cost_price, mrp, quantity_purchased, quantity_available, purchased_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(medicineId, batchNumber, expiryDate, costPrice, mrp, quantity, quantity, purchasedOn);

    const row = db.prepare('SELECT * FROM purchase_batches WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: 'This batch number already exists for the selected medicine.' });
  }
});

app.get('/api/purchases', (req, res) => {
  const rows = db.prepare(`
    SELECT pb.*, m.name as medicine_name, m.strength, m.form, mf.name as manufacturer_name
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY pb.purchased_on DESC, pb.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/sales', (req, res) => {
  const medicineId = Number(req.body.medicine_id);
  const batchId = Number(req.body.batch_id);
  const quantitySold = Number(req.body.quantity_sold);
  const soldOn = (req.body.sold_on || today()).trim();

  if (!medicineId || !batchId || !quantitySold) {
    return res.status(400).json({ error: 'Medicine, batch and quantity are required.' });
  }
  if (quantitySold <= 0) return res.status(400).json({ error: 'Quantity sold must be greater than zero.' });

  const batch = db.prepare('SELECT * FROM purchase_batches WHERE id = ? AND medicine_id = ?').get(batchId, medicineId);
  if (!batch) return res.status(404).json({ error: 'Selected batch not found.' });
  if (batch.quantity_available < quantitySold) {
    return res.status(400).json({ error: 'Not enough stock in selected batch.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE purchase_batches SET quantity_available = quantity_available - ? WHERE id = ?')
      .run(quantitySold, batchId);
    const sale = db.prepare(`
      INSERT INTO sales (medicine_id, batch_id, quantity_sold, sold_on, unit_sale_price, unit_cost_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(medicineId, batchId, quantitySold, soldOn, batch.mrp, batch.cost_price);
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.lastInsertRowid);
  });

  res.status(201).json(tx());
});

app.get('/api/sales', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, pb.batch_number, pb.expiry_date, m.name as medicine_name, m.strength, m.form, mf.name as manufacturer_name,
           ROUND(s.quantity_sold * s.unit_sale_price, 2) as sale_value,
           ROUND(s.quantity_sold * (s.unit_sale_price - s.unit_cost_price), 2) as profit
    FROM sales s
    JOIN purchase_batches pb ON pb.id = s.batch_id
    JOIN medicines m ON m.id = s.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY s.sold_on DESC, s.created_at DESC
  `).all();
  res.json(rows);
});

app.get('/api/dashboard', (req, res) => {
  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM medicines) as total_medicines,
      (SELECT COUNT(*) FROM manufacturers) as total_manufacturers,
      (SELECT COALESCE(SUM(quantity_available), 0) FROM purchase_batches) as total_units,
      (SELECT COUNT(*) FROM purchase_batches WHERE quantity_available > 0 AND expiry_date <= date('now', '+30 day')) as near_expiry_batches,
      (SELECT COUNT(*) FROM purchase_batches WHERE quantity_available > 0 AND expiry_date < date('now')) as expired_batches,
      (SELECT COUNT(*) FROM medicines m WHERE COALESCE((SELECT SUM(quantity_available) FROM purchase_batches WHERE medicine_id = m.id),0) = 0) as out_of_stock_medicines,
      (SELECT COUNT(*) FROM medicines m WHERE COALESCE((SELECT SUM(quantity_available) FROM purchase_batches WHERE medicine_id = m.id),0) BETWEEN 1 AND 20) as low_stock_medicines,
      (SELECT COALESCE(ROUND(SUM(quantity_purchased * cost_price), 2), 0) FROM purchase_batches) as invested_amount,
      (SELECT COALESCE(ROUND(SUM(quantity_available * cost_price), 2), 0) FROM purchase_batches) as current_stock_value,
      (SELECT COALESCE(ROUND(SUM(quantity_sold * unit_sale_price), 2), 0) FROM sales WHERE sold_on = date('now')) as today_sales,
      (SELECT COALESCE(ROUND(SUM(quantity_sold * (unit_sale_price - unit_cost_price)), 2), 0) FROM sales WHERE sold_on = date('now')) as today_profit,
      (SELECT COALESCE(SUM(quantity_sold), 0) FROM sales WHERE sold_on = date('now')) as today_units
  `).get();

  const lowStock = db.prepare(`
    SELECT m.id, m.name, m.strength, m.form, mf.name as manufacturer_name,
           COALESCE(SUM(pb.quantity_available), 0) as total_stock
    FROM medicines m
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN purchase_batches pb ON pb.medicine_id = m.id
    GROUP BY m.id
    HAVING total_stock BETWEEN 1 AND 20
    ORDER BY total_stock ASC, m.name ASC
    LIMIT 6
  `).all();

  const nearExpiry = db.prepare(`
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity_available,
           m.name as medicine_name, mf.name as manufacturer_name
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    WHERE pb.quantity_available > 0 AND pb.expiry_date <= date('now', '+60 day')
    ORDER BY pb.expiry_date ASC
    LIMIT 6
  `).all();

  const recentPurchases = db.prepare(`
    SELECT pb.id, pb.purchased_on, pb.batch_number, pb.quantity_purchased, pb.cost_price,
           m.name as medicine_name, mf.name as manufacturer_name
    FROM purchase_batches pb
    JOIN medicines m ON m.id = pb.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY pb.created_at DESC
    LIMIT 5
  `).all();

  const recentSales = db.prepare(`
    SELECT s.id, s.sold_on, s.quantity_sold, s.unit_sale_price,
           pb.batch_number, m.name as medicine_name, mf.name as manufacturer_name,
           ROUND(s.quantity_sold * s.unit_sale_price, 2) as sale_value
    FROM sales s
    JOIN purchase_batches pb ON pb.id = s.batch_id
    JOIN medicines m ON m.id = s.medicine_id
    JOIN manufacturers mf ON mf.id = m.manufacturer_id
    ORDER BY s.created_at DESC
    LIMIT 5
  `).all();

  res.json({ summary, lowStock, nearExpiry, recentPurchases, recentSales });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`MediStock Lite running on http://localhost:${port}`);
});
