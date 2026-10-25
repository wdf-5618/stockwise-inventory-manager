# Stockwise — Small-Shop Inventory Manager

Stockwise is a standalone browser app for a small shop to keep a simple product catalog, monitor quantities, identify low stock, and export an inventory snapshot. It is built with HTML, CSS, and vanilla JavaScript.

## Features
- Create, edit, and delete products with a name, optional SKU, category, unit cost in Myanmar kyat (MMK), quantity, and low-stock threshold.
- Adjust quantity by one from the inventory list.
- Summary metrics for product count, total units, estimated stock value, and items needing attention.
- Search by product name, SKU, or category.
- Filter by all, low-stock, and out-of-stock products; filter by category.
- Sort by name, lowest stock, highest stock value, or recently added.
- Export inventory to CSV.
- Persist data in this browser using `localStorage`.
- Show a fictional sample catalog on first visit.

## Run locally
Open `index.html` directly, or start a server from the repository root:

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000/](http://localhost:8000/).

## Files
- `index.html` — page structure and form controls.
- `styles.css` — responsive layout and stock status indicators.
- `app.js` — product state, validation, persistence, stock adjustment, filtering, and CSV export.

## Implementation choices
- One product array is the source of truth for the list and summary metrics.
- SKU codes are unique when supplied.
- Quantity zero means out of stock; positive quantity at or below the threshold means low stock.
- User-entered text is rendered through `textContent`, not interpreted as HTML.
- CSV fields are escaped to protect columns containing commas or quotation marks.
- The interface reports when browser storage writes fail.

## Limitations
This is a front-end learning prototype, not a production inventory system. It has no account, shared database, stock movement audit, purchase orders, sales integration, or multi-device sync. Data remains in the current browser profile. Export a CSV backup when needed. Stock value is only a simple estimate based on the entered unit cost.

## Future improvements
Stock movement history, suppliers, CSV import, user permissions, and a database with per-business access controls.
