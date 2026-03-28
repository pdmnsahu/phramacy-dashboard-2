# MediStock Lite

A simple medicine store web app built with:
- Node.js
- Express
- SQLite
- Plain HTML, CSS, and JavaScript served by Express
- No templating engine

## Features
- Create manufacturers
- Create medicines tied to a manufacturer
- Register purchases with cost price, MRP, batch number, expiry, and purchased quantity
- Register sales by choosing a medicine and then a batch
- Sale form auto-selects the batch with the closest expiry date
- Dashboard with live summary cards and recent activity
- UI updates instantly after every create/purchase/sale action by re-fetching fresh data from the backend without a browser refresh

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
- The SQLite file is created automatically at `data/pharmacy.sqlite`
- Some demo seed data is inserted on first run
- Theme styling is inspired by the provided teal pharmacy dashboard
