# Stockwise — Small-Shop Inventory Manager

Stockwise is a standalone browser app for a small shop to keep a simple product catalog, monitor quantities, identify low stock, and export inventory snapshots. It is built with HTML, CSS, and vanilla JavaScript.

## Features

- Create, edit, and delete products with a name, optional SKU, category, unit cost in Myanmar kyat (MMK), quantity, and low-stock threshold.
- Adjust stock quantities and record the reason and resulting balance in a movement history.
- Review the latest stock changes and export the audit history as CSV.
- Import product catalogs from CSV, with validation and a confirmation summary before applying changes.
- Update an existing product by matching its SKU; when the SKU is blank, matching uses product name and category.
- Summary metrics for product count, total units, estimated stock value, and items needing attention.
- Search by product name, SKU, or category; filter by stock status/category; sort by name, quantity, value, or date.
- Export the current product catalog to CSV.
- Persist products and movement history in this browser using `localStorage`.
- Load fictional sample products on the first visit.

## Run locally

Open `index.html` directly, or start a server from the repository root:

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000/](http://localhost:8000/).

## Files

- `index.html` — page structure, catalog controls, CSV import/export, and movement history.
- `styles.css` — responsive layout, stock status indicators, and movement styles.
- `app.js` — product state, persistence, validation, movements, CSV parsing/import, filtering, sorting, and exports.

## Implementation choices

- One product array is the source of truth for the catalog and summary metrics.
- Stock movements are snapshots that preserve the product name/SKU, change amount, resulting quantity, action, note, and timestamp.
- The movement history is capped at 500 records to keep local storage bounded.
- This version cannot reconstruct movements that happened before history tracking was added. Existing quantities are recorded as opening balances, with that limitation stated in each note.
- CSV import validates rows and duplicate identities before asking for confirmation; invalid rows are skipped rather than silently accepted.
- SKU codes are unique when supplied in the product form.
- User-entered text is rendered through `textContent`, not interpreted as HTML.
- CSV values are quoted and embedded quotes are escaped; text that resembles spreadsheet formulas is prefixed defensively.
- The interface reports when browser storage writes fail.

## Limitations

This is a front-end learning prototype, not a production inventory system. It has no account, shared database, supplier records, purchase orders, sales integration, or multi-device synchronization. Products and movement history remain in the current browser profile. Clearing site data may remove them. Export both the product catalog and movement history if you need separate backups. Stock value is a simple estimate based on the entered unit cost.

## Future improvements

A database-backed version could store products and movements in relational tables, enforce stock updates transactionally, add authenticated access, and maintain per-business authorization policies.
