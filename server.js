"use strict";

// Local, single-user API. Requires Node.js 22.13+ (built-in node:sqlite).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATABASE_PATH = path.join(DATA_DIR, "stockwise.sqlite");
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCTS = 10000;
const MAX_MOVEMENTS = 500;
const MAX_QUANTITY = 999999999;
const MAX_COST = 999999999;
const CATEGORIES = new Set(["Stationery", "Groceries", "Electronics", "Clothing", "Household", "Other"]);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 3000;

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    sku TEXT NOT NULL DEFAULT '' CHECK (length(sku) <= 40),
    category TEXT NOT NULL CHECK (category IN ('Stationery','Groceries','Electronics','Clothing','Household','Other')),
    cost REAL NOT NULL CHECK (cost >= 0 AND cost <= 999999999),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 0 AND 999999999),
    reorder_level INTEGER NOT NULL CHECK (reorder_level BETWEEN 0 AND 999999999),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS products_sku_nonempty
    ON products (lower(sku)) WHERE sku <> '';
  CREATE INDEX IF NOT EXISTS products_name_category
    ON products (lower(name), lower(category));

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL CHECK (length(product_name) BETWEEN 1 AND 100),
    sku TEXT NOT NULL DEFAULT '' CHECK (length(sku) <= 40),
    type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 60),
    delta INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL CHECK (quantity_after BETWEEN 0 AND 999999999),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 180),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS movements_created_at
    ON stock_movements (created_at DESC);

  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  ) STRICT;
  INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('initialized', 'false');
`);

const selectProducts = db.prepare(`
  SELECT id, name, sku, category, cost, quantity, reorder_level AS reorderLevel,
         created_at AS createdAt, updated_at AS updatedAt
  FROM products ORDER BY created_at DESC, rowid DESC
`);
const selectMovements = db.prepare(`
  SELECT id, product_id AS productId, product_name AS productName, sku, type,
         delta, quantity_after AS quantityAfter, note, created_at AS createdAt
  FROM stock_movements ORDER BY created_at DESC, rowid DESC LIMIT ?
`);
const insertProduct = db.prepare(`
  INSERT INTO products
    (id, name, sku, category, cost, quantity, reorder_level, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertMovement = db.prepare(`
  INSERT INTO stock_movements
    (id, product_id, product_name, sku, type, delta, quantity_after, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const initializedStatement = db.prepare("SELECT value FROM app_metadata WHERE key = 'initialized'");
const markInitialized = db.prepare("UPDATE app_metadata SET value = 'true' WHERE key = 'initialized'");

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function badRequest(res, message, statusCode = 400) {
  json(res, statusCode, { error: message });
}

function safeInt(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validateSnapshot(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The request body must be a JSON object.";
  if (!Array.isArray(body.products) || !Array.isArray(body.movements)) return "Both products and movements must be arrays.";
  if (body.products.length > MAX_PRODUCTS) return "Too many products.";
  if (body.movements.length > MAX_MOVEMENTS) return "Too many stock movements.";

  const ids = new Set();
  const skus = new Set();
  for (const p of body.products) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return "A product record is invalid.";
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const sku = typeof p.sku === "string" ? p.sku.trim() : "";
    const cost = Number(p.cost);
    if (!id || id.length > 100 || ids.has(id)) return "Product IDs must be unique non-empty strings.";
    if (!name || name.length > 100 || sku.length > 40) return "Product name or SKU is invalid.";
    if (!CATEGORIES.has(p.category)) return "A product category is invalid.";
    if (!Number.isFinite(cost) || cost < 0 || cost > MAX_COST) return "A product cost is invalid.";
    if (!safeInt(Number(p.quantity), 0, MAX_QUANTITY) ||
        !safeInt(Number(p.reorderLevel), 0, MAX_QUANTITY)) return "A product quantity or reorder level is invalid.";
    if (!safeInt(Number(p.createdAt), 0, Number.MAX_SAFE_INTEGER) ||
        !safeInt(Number(p.updatedAt), 0, Number.MAX_SAFE_INTEGER)) return "A product timestamp is invalid.";
    if (sku) {
      const key = sku.toLocaleLowerCase("en");
      if (skus.has(key)) return "Each non-empty SKU must be unique.";
      skus.add(key);
    }
    ids.add(id);
  }

  const movementIds = new Set();
  for (const m of body.movements) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return "A movement record is invalid.";
    const id = typeof m.id === "string" ? m.id.trim() : "";
    const name = typeof m.productName === "string" ? m.productName.trim() : "";
    const type = typeof m.type === "string" ? m.type.trim() : "";
    const sku = typeof m.sku === "string" ? m.sku : "";
    const note = typeof m.note === "string" ? m.note : "";
    if (!id || id.length > 100 || movementIds.has(id)) return "Movement IDs must be unique non-empty strings.";
    if (!name || name.length > 100 || !type || type.length > 60) return "Movement name or type is invalid.";
    if (sku.length > 40 || note.length > 180) return "Movement SKU or note is too long.";
    if (!safeInt(Number(m.delta), -MAX_QUANTITY, MAX_QUANTITY) ||
        !safeInt(Number(m.quantityAfter), 0, MAX_QUANTITY)) return "A movement quantity is invalid.";
    if (!safeInt(Number(m.createdAt), 0, Number.MAX_SAFE_INTEGER)) return "A movement timestamp is invalid.";
    if (m.productId !== undefined && typeof m.productId !== "string") return "A movement product ID is invalid.";
    movementIds.add(id);
  }
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(Object.assign(new Error("Request body is larger than 5 MB."), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      if (!chunks.length) return reject(Object.assign(new Error("A JSON body is required."), { statusCode: 400 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Request body is not valid JSON."), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

function saveSnapshot(body) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM stock_movements; DELETE FROM products;");
    for (const p of body.products) {
      insertProduct.run(
        p.id.trim(), p.name.trim(), typeof p.sku === "string" ? p.sku.trim() : "",
        p.category, Number(p.cost), Number(p.quantity), Number(p.reorderLevel),
        Number(p.createdAt), Number(p.updatedAt)
      );
    }
    for (const m of body.movements) {
      insertMovement.run(
        m.id.trim(), typeof m.productId === "string" ? m.productId : "",
        m.productName.trim(), typeof m.sku === "string" ? m.sku : "",
        m.type.trim(), Number(m.delta), Number(m.quantityAfter),
        typeof m.note === "string" ? m.note : "", Number(m.createdAt)
      );
    }
    markInitialized.run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getSnapshot() {
  return {
    initialized: initializedStatement.get().value === "true",
    products: selectProducts.all(),
    movements: selectMovements.all(MAX_MOVEMENTS)
  };
}

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"]
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || (HOST + ":" + PORT)));
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health" && req.method === "GET") {
        return json(res, 200, { ok: true, storage: "sqlite", mode: "single-user-local" });
      }
      if (url.pathname === "/api/state" && req.method === "GET") {
        return json(res, 200, getSnapshot());
      }
      if (url.pathname === "/api/state" && req.method === "PUT") {
        const origin = req.headers.origin;
        if (origin && origin !== "http://" + req.headers.host) {
          return badRequest(res, "Cross-origin updates are not allowed.", 403);
        }
        const body = await readJsonBody(req);
        const validationError = validateSnapshot(body);
        if (validationError) return badRequest(res, validationError);
        saveSnapshot(body);
        return json(res, 200, { ok: true, products: body.products.length, movements: body.movements.length });
      }
      return badRequest(res, "API route not found.", 404);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return badRequest(res, "Method not allowed.", 405);
    const entry = staticFiles[url.pathname];
    if (!entry) return badRequest(res, "Not found.", 404);
    const [filename, contentType] = entry;
    const content = fs.readFileSync(path.join(ROOT, filename));
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (!res.headersSent) {
      const code = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      json(res, code, { error: code === 500 ? "An unexpected server error occurred." : error.message });
    } else {
      res.destroy();
    }
    if (!Number.isInteger(error.statusCode)) console.error("Stockwise request failed:", error.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log("Stockwise is running at http://" + HOST + ":" + PORT);
  console.log("SQLite database: " + DATABASE_PATH);
});
process.on("SIGINT", () => { db.close(); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { db.close(); server.close(() => process.exit(0)); });
