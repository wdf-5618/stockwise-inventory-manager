# Stockwise — Small-Shop Inventory Manager

Stockwise is a small-shop inventory app built with HTML, CSS, and vanilla JavaScript. It helps a shop keep a product catalog, review stock levels, record stock movements, and exchange inventory data through CSV.

## Features

- Create, edit, and delete products with name, optional SKU, category, cost in Myanmar kyat (MMK), quantity, and low-stock threshold.
- Adjust quantities and flag low-stock or out-of-stock items.
- Search, filter, sort, and review inventory summaries.
- Import and export product CSV files, with field validation and duplicate checks.
- Keep a stock movement log and export that history separately.
- Preserve a browser-local copy for static/offline use.
- When started with the local server, sync the catalog and movement history to a SQLite database file using a transaction.

## Run with SQLite persistence

1. Install Node.js 22.13 or later.
2. In this repository directory, run:

   ```sh
   npm start
   ```

3. Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

The first run creates `data/stockwise.sqlite` automatically and migrates the current browser catalog into the database if the database has not been initialized yet. When an initialized database already exists, its records replace the local browser copy. The header indicates whether SQLite mode is active.

The server uses Node's built-in `node:sqlite` API and no third-party npm packages. Run `npm run check` for JavaScript syntax checks.

## Browser-only mode

Opening `index.html` directly or hosting the static files without this API keeps data in that browser's localStorage. Browser-only records are not automatically shared with the SQLite service until the app is opened through the server for the first time.

## Data and security notes

- This is a local, single-user portfolio/demo application. The server binds to `127.0.0.1` by default and does not provide accounts, authentication, multi-user access, or remote-hosting security.
- The API validates input, uses SQL constraints and prepared statements, and replaces a snapshot inside one SQLite transaction.
- The database file and its write-ahead-log files are ignored by Git. Back up `data/stockwise.sqlite` separately if you use real data.
- CSV imports can only record changes made after the movement-history feature began; older movements cannot be reconstructed.
- Demo products are fictional and are intended only to make the first visit understandable.

## Project structure

- `index.html` — app structure
- `styles.css` — responsive visual system
- `app.js` — inventory interactions, CSV tools, browser fallback, API sync
- `server.js` — local HTTP server and JSON API
- `package.json` — start and syntax-check scripts

## Future work

The current API syncs a validated full-state snapshot. A production multi-user system would use authenticated users, per-record CRUD endpoints, server-enforced access controls, and stock-movement writes that are atomic with each quantity adjustment.
