# MediStock Pro

A single-store pharmacy inventory web app built with Node.js, Express, SQLite, and plain HTML/CSS/JavaScript.

## Features

- Manufacturer and medicine master creation
- Per-medicine reorder level for low-stock alerts
- Batch-based purchases with cost price, MRP, expiry, and quantity
- Batch-aware sales with default FEFO selection (closest non-expired batch first)
- Discard / write-off flow for expired, damaged, missing, or adjustment stock
- Dashboard with live low-stock, near-expiry, expired-stock, and write-off visibility
- Profit reporting for today, last week, last month, last 7 days, month-to-date, and custom range
- Instant UI refresh everywhere after every transaction without manual reload

## Run

```bash
npm install
npm start
```

Then open:

```bash
http://localhost:3000
```

## Notes

- The app auto-creates the `data/` folder and SQLite database on first run.
- SQLite is fine for a small single-store setup.
- For production use across multiple counters or stores, move to PostgreSQL and add authentication, backups, billing, and audit logs.
