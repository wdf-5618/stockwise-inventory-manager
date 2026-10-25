"use strict";

// Stockwise is a front-end demo: all product data is local to this browser.
// Keeping state in one array makes the summary counts and filtered list agree.
const STORAGE_KEY = "stockwise.inventory.v1";
const MOVEMENTS_KEY = "stockwise.movements.v1";
const MAX_MOVEMENTS = 500;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_QUANTITY = 999999999;
const MAX_COST = 999999999;
const CATEGORIES = ["Stationery", "Groceries", "Electronics", "Clothing", "Household", "Other"];

const el = {
  form: document.querySelector("#product-form"),
  name: document.querySelector("#product-name"),
  sku: document.querySelector("#product-sku"),
  category: document.querySelector("#product-category"),
  cost: document.querySelector("#product-cost"),
  quantity: document.querySelector("#product-quantity"),
  reorder: document.querySelector("#product-reorder"),
  formHeading: document.querySelector("#form-heading"),
  saveButton: document.querySelector("#save-product"),
  cancelEdit: document.querySelector("#cancel-edit"),
  formError: document.querySelector("#form-error"),
  formStatus: document.querySelector("#form-status"),
  search: document.querySelector("#product-search"),
  sort: document.querySelector("#sort-products"),
  categoryFilter: document.querySelector("#category-filter"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  productList: document.querySelector("#inventory-list"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  emptyAction: document.querySelector("#empty-action"),
  productsCount: document.querySelector("#products-count"),
  unitsCount: document.querySelector("#units-count"),
  stockValue: document.querySelector("#stock-value"),
  attentionCount: document.querySelector("#attention-count"),
  visibleCount: document.querySelector("#visible-count"),
  allCount: document.querySelector("#all-count"),
  lowCount: document.querySelector("#low-count"),
  outCount: document.querySelector("#out-count"),
  inventoryFooter: document.querySelector("#inventory-footer"),
  todayLabel: document.querySelector("#today-label"),
  exportButton: document.querySelector("#export-button"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  exportHistoryButton: document.querySelector("#export-history"),
  movementList: document.querySelector("#movement-list"),
  movementEmpty: document.querySelector("#movement-empty"),
  movementCount: document.querySelector("#movement-count"),
  movementFooter: document.querySelector("#movement-footer"),
  toast: document.querySelector("#toast")
};

let products = loadProducts();
let movements = loadMovements();
let activeFilter = "all";
let editingId = null;
let toastTimer = null;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedProduct(record) {
  if (!isPlainObject(record) || typeof record.id !== "string" || typeof record.name !== "string") return null;
  const cost = Number(record.cost);
  const quantity = Number(record.quantity);
  const reorderLevel = Number(record.reorderLevel);
  if (!Number.isFinite(cost) || cost < 0 || cost > MAX_COST) return null;
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) return null;
  if (!Number.isSafeInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > MAX_QUANTITY) return null;

  return {
    id: record.id,
    name: record.name.trim().slice(0, 100),
    sku: typeof record.sku === "string" ? record.sku.trim().slice(0, 40) : "",
    category: CATEGORIES.includes(record.category) ? record.category : "Other",
    cost,
    quantity,
    reorderLevel,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now()
  };
}

function loadProducts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      // NOTE: Seed a few clearly fictional items on the very first visit so a
      // reviewer can see meaningful stock states before entering their own data.
      const now = Date.now();
      return [
        { id: "demo-paper", name: "A4 Copy Paper", sku: "PAP-001", category: "Stationery", cost: 3500, quantity: 18, reorderLevel: 6, createdAt: now - 3000, updatedAt: now - 3000 },
        { id: "demo-water", name: "Bottled Water 600ml", sku: "GRO-014", category: "Groceries", cost: 250, quantity: 4, reorderLevel: 10, createdAt: now - 2000, updatedAt: now - 2000 },
        { id: "demo-cable", name: "USB-C Charging Cable", sku: "ELE-022", category: "Electronics", cost: 4200, quantity: 0, reorderLevel: 3, createdAt: now - 1000, updatedAt: now - 1000 },
        { id: "demo-tote", name: "Cotton Tote Bag", sku: "CLO-008", category: "Clothing", cost: 1800, quantity: 14, reorderLevel: 5, createdAt: now, updatedAt: now }
      ];
    }
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizedProduct).filter((product) => product && product.name);
  } catch (error) {
    console.warn("Could not read the saved inventory from this browser.", error);
    return [];
  }
}


function normalizeMovement(record) {
  if (!isPlainObject(record) || typeof record.id !== "string") return null;
  if (typeof record.productName !== "string") return null;
  const delta = Number(record.delta);
  const quantityAfter = Number(record.quantityAfter);
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(quantityAfter) || quantityAfter < 0) return null;

  return {
    id: record.id,
    productId: typeof record.productId === "string" ? record.productId : "",
    productName: record.productName.slice(0, 100),
    sku: typeof record.sku === "string" ? record.sku.slice(0, 40) : "",
    type: typeof record.type === "string" ? record.type.slice(0, 60) : "Stock change",
    delta,
    quantityAfter,
    note: typeof record.note === "string" ? record.note.slice(0, 180) : "",
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now()
  };
}

function loadMovements() {
  try {
    const saved = localStorage.getItem(MOVEMENTS_KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeMovement).filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_MOVEMENTS);
    }

    // We cannot reconstruct movements from before this feature existed. Start
    // an honest history using each product's current quantity as its opening balance.
    const now = Date.now();
    const openingMovements = products.map((product) => ({
      id: createId(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      type: "Opening balance",
      delta: product.quantity,
      quantityAfter: product.quantity,
      note: "History started from the current catalog; older movements are unavailable.",
      createdAt: product.createdAt || now
    })).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_MOVEMENTS);

    localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(openingMovements));
    return openingMovements;
  } catch (error) {
    console.warn("Could not read or initialize stock movement history.", error);
    return products.map((product) => ({
      id: createId(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      type: "Opening balance",
      delta: product.quantity,
      quantityAfter: product.quantity,
      note: "History started from the current catalog; older movements are unavailable.",
      createdAt: product.createdAt || Date.now()
    })).slice(0, MAX_MOVEMENTS);
  }
}

function saveMovements() {
  try {
    localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(movements.slice(0, MAX_MOVEMENTS)));
    return true;
  } catch (error) {
    console.warn("Could not save stock movement history.", error);
    return false;
  }
}

function saveProducts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    return true;
  } catch (error) {
    // NOTE: Private browsing or storage limits can block writes; report this
    // rather than telling the user data was saved when it was not.
    console.warn("Could not save the inventory in this browser.", error);
    return false;
  }
}


function saveState() {
  // Save each record set independently so one failed write does not short-circuit the other.
  const productsSaved = saveProducts();
  const movementsSaved = saveMovements();
  return productsSaved && movementsSaved;
}

function recordMovement(product, delta, quantityAfter, type, note) {
  movements.unshift({
    id: createId(),
    productId: product.id,
    productName: product.name,
    sku: product.sku || "",
    type,
    delta,
    quantityAfter,
    note: note || "",
    createdAt: Date.now()
  });
  movements = movements.slice(0, MAX_MOVEMENTS);
}

function createId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMoney(value) {
  // Show the currency explicitly because the app is intended for Myanmar shops.
  return "MMK " + Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCount(value) {
  return Number(value).toLocaleString();
}

function stockStatus(product) {
  if (product.quantity === 0) return { key: "out", label: "Out of stock" };
  if (product.quantity <= product.reorderLevel) return { key: "low", label: "Low stock" };
  return { key: "ok", label: "In stock" };
}

function isLowStock(product) {
  return product.quantity > 0 && product.quantity <= product.reorderLevel;
}

function isNeedsAttention(product) {
  return product.quantity === 0 || isLowStock(product);
}

function getVisibleProducts() {
  const query = el.search.value.trim().toLocaleLowerCase();
  const category = el.categoryFilter.value;

  return products.filter((product) => {
    if (activeFilter === "low" && !isLowStock(product)) return false;
    if (activeFilter === "out" && product.quantity !== 0) return false;
    if (category !== "all" && product.category !== category) return false;

    if (query) {
      const searchable = [product.name, product.sku, product.category]
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).sort(compareProducts);
}

function compareProducts(a, b) {
  switch (el.sort.value) {
    case "stock-asc":
      return a.quantity - b.quantity || a.name.localeCompare(b.name);
    case "value-desc":
      return (b.cost * b.quantity) - (a.cost * a.quantity) || a.name.localeCompare(b.name);
    case "recent":
      return b.createdAt - a.createdAt;
    case "name":
    default:
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  }
}

function productCard(product) {
  const item = makeElement("article", "product-row");
  const main = makeElement("div", "product-main");
  const heading = makeElement("div", "product-heading");
  heading.append(makeElement("h3", "product-name", product.name));
  if (product.sku) heading.append(makeElement("span", "product-sku", product.sku));

  const details = makeElement("div", "product-details");
  details.append(makeElement("span", "category-badge", product.category));
  const status = stockStatus(product);
  details.append(makeElement("span", "status-pill status-" + status.key, status.label));

  const financials = makeElement("div", "product-financials");
  financials.append(makeElement("span", "", "Unit cost: "));
  financials.lastElementChild.append(makeElement("strong", "", formatMoney(product.cost)));
  financials.append(makeElement("span", "", "Stock value: "));
  financials.lastElementChild.append(makeElement("strong", "", formatMoney(product.cost * product.quantity)));

  main.append(heading, details, financials);

  const side = makeElement("div", "product-side");
  const stockControl = makeElement("div", "stock-control");
  const decrease = makeElement("button", "", "−");
  decrease.type = "button";
  decrease.disabled = product.quantity <= 0;
  decrease.setAttribute("aria-label", "Decrease stock for " + product.name);
  decrease.title = "Decrease quantity by one";
  decrease.addEventListener("click", () => adjustStock(product.id, -1));

  const quantity = makeElement("span", "stock-number", formatCount(product.quantity));
  quantity.setAttribute("aria-label", product.quantity + " units in stock");

  const increase = makeElement("button", "", "+");
  increase.type = "button";
  increase.disabled = product.quantity >= MAX_QUANTITY;
  increase.setAttribute("aria-label", "Increase stock for " + product.name);
  increase.title = "Increase quantity by one";
  increase.addEventListener("click", () => adjustStock(product.id, 1));

  stockControl.append(decrease, quantity, increase);

  const actions = makeElement("div", "product-actions");
  const edit = makeElement("button", "icon-action", "✎");
  edit.type = "button";
  edit.title = "Edit product";
  edit.setAttribute("aria-label", "Edit product " + product.name);
  edit.addEventListener("click", () => beginEdit(product.id));

  const remove = makeElement("button", "icon-action delete", "×");
  remove.type = "button";
  remove.title = "Delete product";
  remove.setAttribute("aria-label", "Delete product " + product.name);
  remove.addEventListener("click", () => deleteProduct(product.id));

  actions.append(edit, remove);
  side.append(stockControl, actions);
  item.append(main, side);
  return item;
}


function formatMovementTime(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}

function movementCard(movement) {
  const row = makeElement("article", "movement-row");
  const marker = makeElement("span", "movement-marker", movement.delta > 0 ? "＋" : movement.delta < 0 ? "−" : "•");
  marker.setAttribute("aria-hidden", "true");

  const main = makeElement("div", "movement-main");
  const titleRow = makeElement("div", "movement-title-row");
  titleRow.append(makeElement("h3", "movement-product", movement.productName));
  titleRow.append(makeElement("span", "movement-type", movement.type));
  main.append(titleRow);

  const metadata = makeElement("p", "movement-meta");
  const details = [movement.sku, formatMovementTime(movement.createdAt), movement.note].filter(Boolean);
  metadata.textContent = details.join(" · ");
  main.append(metadata);

  const values = makeElement("div", "movement-values");
  const deltaText = movement.delta > 0
    ? "+" + formatCount(movement.delta)
    : movement.delta < 0 ? "−" + formatCount(Math.abs(movement.delta)) : "0";
  values.append(makeElement(
    "strong",
    "movement-delta " + (movement.delta > 0 ? "positive" : movement.delta < 0 ? "negative" : "neutral"),
    deltaText
  ));
  values.append(makeElement("span", "movement-balance", "Balance " + formatCount(movement.quantityAfter)));

  row.append(marker, main, values);
  return row;
}

function renderMovementHistory() {
  const recent = [...movements].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  el.movementCount.textContent = formatCount(movements.length);
  el.movementList.replaceChildren(...recent.map(movementCard));
  el.movementEmpty.hidden = recent.length > 0;

  if (movements.length === 0) {
    el.movementFooter.textContent = "Stock activity will appear here.";
  } else {
    el.movementFooter.textContent = "Showing the latest " + recent.length +
      " of " + movements.length + " recorded movements. History is kept in this browser.";
  }
}

function render() {
  const visible = getVisibleProducts();
  const units = products.reduce((sum, product) => sum + product.quantity, 0);
  const value = products.reduce((sum, product) => sum + product.cost * product.quantity, 0);
  const low = products.filter(isLowStock).length;
  const out = products.filter((product) => product.quantity === 0).length;
  const attention = low + out;

  el.productsCount.textContent = formatCount(products.length);
  el.unitsCount.textContent = formatCount(units);
  el.stockValue.textContent = formatMoney(value);
  el.attentionCount.textContent = formatCount(attention);
  el.visibleCount.textContent = formatCount(visible.length);
  el.allCount.textContent = formatCount(products.length);
  el.lowCount.textContent = formatCount(low);
  el.outCount.textContent = formatCount(out);

  el.filterButtons.forEach((button) => {
    const selected = button.dataset.filter === activeFilter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  el.productList.replaceChildren(...visible.map(productCard));
  el.emptyState.hidden = visible.length > 0;

  if (visible.length === 0 && products.length === 0) {
    el.emptyTitle.textContent = "A clear shelf to start.";
    el.emptyDescription.textContent = "Add your first product to begin keeping track of stock.";
    el.emptyAction.textContent = "Add a product ↗";
  } else if (visible.length === 0) {
    el.emptyTitle.textContent = "No products match this view.";
    el.emptyDescription.textContent = "Try another search or change the stock/category filters.";
    el.emptyAction.textContent = "Clear search and filters ↗";
  }

  if (products.length === 0) {
    el.inventoryFooter.textContent = "Your catalog is ready when you are.";
  } else if (attention > 0) {
    el.inventoryFooter.textContent = attention + " product" + (attention === 1 ? "" : "s") + " need" + (attention === 1 ? "s" : "") + " a stock review.";
  } else {
    el.inventoryFooter.textContent = "All products are above their low-stock thresholds.";
  }
  renderMovementHistory();
}

function setFormMode(isEditing) {
  el.formHeading.textContent = isEditing ? "Edit product" : "Add a product";
  el.saveButton.innerHTML = isEditing ? "Save changes" : '<span aria-hidden="true">＋</span> Add product';
  el.cancelEdit.hidden = !isEditing;
}

function resetForm() {
  editingId = null;
  el.form.reset();
  el.category.value = "Stationery";
  el.cost.value = "0";
  el.quantity.value = "0";
  el.reorder.value = "5";
  el.formError.hidden = true;
  el.formError.textContent = "";
  el.formStatus.textContent = "";
  setFormMode(false);
}

function beginEdit(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;

  editingId = id;
  el.name.value = product.name;
  el.sku.value = product.sku;
  el.category.value = product.category;
  el.cost.value = String(product.cost);
  el.quantity.value = String(product.quantity);
  el.reorder.value = String(product.reorderLevel);
  el.formError.hidden = true;
  el.formStatus.textContent = "Editing " + product.name + ". Save or cancel your changes.";
  setFormMode(true);
  el.name.focus();
  document.querySelector(".form-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showFormError(message) {
  el.formError.textContent = message;
  el.formError.hidden = false;
}

function validateForm() {
  const name = el.name.value.trim();
  const sku = el.sku.value.trim();
  const cost = Number(el.cost.value);
  const quantity = Number(el.quantity.value);
  const reorderLevel = Number(el.reorder.value);

  if (!name) return { error: "Please enter a product name." };
  if (!Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
    return { error: "Unit cost must be a valid non-negative number." };
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
    return { error: "Quantity must be a whole number between 0 and " + MAX_QUANTITY + "." };
  }
  if (!Number.isSafeInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > MAX_QUANTITY) {
    return { error: "The low-stock threshold must be a non-negative whole number." };
  }

  // SECURITY/UX: a SKU is used as a product identifier in real inventory
  // systems, so prevent duplicate codes within this local catalog.
  const duplicate = products.some((product) =>
    product.id !== editingId && sku && product.sku.toLocaleLowerCase() === sku.toLocaleLowerCase()
  );
  if (duplicate) return { error: "That SKU is already used by another product. Enter a unique code." };

  return {
    product: {
      name,
      sku,
      category: CATEGORIES.includes(el.category.value) ? el.category.value : "Other",
      cost,
      quantity,
      reorderLevel
    }
  };
}

function handleSubmit(event) {
  event.preventDefault();
  el.formError.hidden = true;
  el.formStatus.textContent = "";
  const result = validateForm();
  if (result.error) {
    showFormError(result.error);
    return;
  }

  const now = Date.now();
  if (editingId) {
    const current = products.find((product) => product.id === editingId);
    if (!current) {
      resetForm();
      render();
      return;
    }
    const previousQuantity = current.quantity;
    Object.assign(current, result.product, { updatedAt: now });
    if (current.quantity !== previousQuantity) {
      recordMovement(
        current,
        current.quantity - previousQuantity,
        current.quantity,
        "Manual correction",
        "Quantity changed in the product edit form"
      );
    }
    const saved = saveState();
    resetForm();
    render();
    showToast(saved ? "Product updated." : "Updated on screen, but the browser could not save all changes.");
    return;
  }

  const product = {
    id: createId(),
    ...result.product,
    createdAt: now,
    updatedAt: now
  };
  products.unshift(product);
  recordMovement(product, product.quantity, product.quantity, "Opening balance", "Product added to the catalog");
  const saved = saveState();
  resetForm();
  render();
  showToast(saved ? "Product added to inventory." : "Added on screen, but the browser could not save all changes.");
  el.name.focus();
}

function adjustStock(id, change) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const next = product.quantity + change;
  if (next < 0 || next > MAX_QUANTITY) return;

  product.quantity = next;
  product.updatedAt = Date.now();
  recordMovement(
    product,
    change,
    next,
    change > 0 ? "Stock increase" : "Stock decrease",
    "Manual one-unit adjustment"
  );
  const saved = saveState();
  render();
  showToast(saved
    ? product.name + " now has " + formatCount(product.quantity) + " units."
    : "Stock changed on screen, but the browser could not save all changes.");
}

function deleteProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  if (!window.confirm('Delete "' + product.name + '" from this inventory? This cannot be undone.')) return;

  recordMovement(
    product,
    -product.quantity,
    0,
    "Product removed",
    "Deleted from active catalog; previous movements remain in history"
  );
  products = products.filter((item) => item.id !== id);
  if (editingId === id) resetForm();
  const saved = saveState();
  render();
  showToast(saved ? "Product deleted." : "Product deleted on screen, but the browser could not save all changes.");
}

function csvCell(value) {
  // Quote every cell and escape embedded quotes. Also neutralize text that spreadsheet
  // software could otherwise interpret as a formula after opening the CSV.
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\\-@\\t\\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportCsv() {
  if (products.length === 0) {
    showToast("Add at least one product before exporting.");
    return;
  }

  const headers = [
    "product_name", "sku", "category", "unit_cost_mmk", "quantity",
    "low_stock_threshold", "stock_value_mmk", "stock_status"
  ];
  const rows = products.map((product) => [
    product.name,
    product.sku,
    product.category,
    product.cost.toFixed(2),
    product.quantity,
    product.reorderLevel,
    (product.cost * product.quantity).toFixed(2),
    stockStatus(product).label
  ]);
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "stockwise-inventory.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("CSV export created.");
}


function exportMovementHistory() {
  if (movements.length === 0) {
    showToast("There is no stock history to export yet.");
    return;
  }
  const headers = [
    "timestamp", "product_name", "sku", "action", "quantity_change",
    "quantity_after", "note"
  ];
  const rows = [...movements]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((movement) => [
      new Date(movement.createdAt).toISOString(),
      movement.productName,
      movement.sku,
      movement.type,
      movement.delta,
      movement.quantityAfter,
      movement.note
    ]);
  const csv = "\\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\\r\\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "stockwise-movement-history.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Stock movement history exported.");
}


function parseCsvRows(source) {
  const text = source.replace(/^\\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\\n" || char === "\\r") && !inQuotes) {
      if (char === "\\r" && text[index + 1] === "\\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (inQuotes) throw new Error("The CSV contains an unmatched quotation mark.");
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function csvImportField(row, positions, ...names) {
  for (const name of names) {
    const position = positions.get(name);
    if (position !== undefined) return String(row[position] ?? "").trim();
  }
  return "";
}

function prepareCsvImport(source) {
  const rows = parseCsvRows(source);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one product row.");

  const headers = rows[0].map((header) =>
    header.trim().toLocaleLowerCase().replace(/\\s+/g, "_").replace(/-/g, "_")
  );
  const positions = new Map(headers.map((header, index) => [header, index]));
  if (!positions.has("product_name") && !positions.has("name")) {
    throw new Error("Could not find a product_name or name column.");
  }
  if (!positions.has("quantity")) throw new Error("Could not find a quantity column.");
  if (!positions.has("unit_cost_mmk") && !positions.has("unit_cost") && !positions.has("cost")) {
    throw new Error("Could not find a unit_cost_mmk, unit_cost, or cost column.");
  }

  const staged = [];
  const seenIdentities = new Set();
  let invalid = 0;

  for (const row of rows.slice(1)) {
    const name = csvImportField(row, positions, "product_name", "name").slice(0, 100);
    const sku = csvImportField(row, positions, "sku", "code").slice(0, 40);
    const categoryValue = csvImportField(row, positions, "category");
    const category = CATEGORIES.find((item) => item.toLocaleLowerCase() === categoryValue.toLocaleLowerCase()) || "Other";
    const costRaw = csvImportField(row, positions, "unit_cost_mmk", "unit_cost", "cost");
    const quantityRaw = csvImportField(row, positions, "quantity");
    const reorderRaw = csvImportField(row, positions, "low_stock_threshold", "reorder_level", "reorderlevel");
    const cost = Number(costRaw);
    const quantity = Number(quantityRaw);
    const reorderLevel = reorderRaw === "" ? 5 : Number(reorderRaw);

    if (!name || costRaw === "" || quantityRaw === "" ||
        !Number.isFinite(cost) || cost < 0 || cost > MAX_COST ||
        !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY ||
        !Number.isSafeInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > MAX_QUANTITY) {
      invalid += 1;
      continue;
    }

    const identity = sku
      ? "sku:" + sku.toLocaleLowerCase()
      : "name:" + name.toLocaleLowerCase() + "|category:" + category.toLocaleLowerCase();
    if (seenIdentities.has(identity)) {
      invalid += 1;
      continue;
    }
    seenIdentities.add(identity);

    const existing = products.find((product) => sku
      ? product.sku && product.sku.toLocaleLowerCase() === sku.toLocaleLowerCase()
      : !product.sku && product.name.toLocaleLowerCase() === name.toLocaleLowerCase() && product.category === category
    ) || null;

    staged.push({
      existingId: existing ? existing.id : null,
      product: { name, sku, category, cost, quantity, reorderLevel }
    });
  }
  return { staged, invalid, rowsRead: rows.length - 1 };
}

async function handleCsvImport() {
  const file = el.importFile.files && el.importFile.files[0];
  el.importFile.value = "";
  if (!file) return;
  if (!file.name.toLocaleLowerCase().endsWith(".csv") && file.type !== "text/csv") {
    showToast("Please choose a .csv file.");
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    showToast("CSV file is too large. The maximum size is 5 MB.");
    return;
  }

  try {
    const prepared = prepareCsvImport(await file.text());
    if (prepared.staged.length === 0) {
      showToast("No valid product rows were found. " + prepared.invalid + " row(s) skipped.");
      return;
    }

    const newCount = prepared.staged.filter((entry) => !entry.existingId).length;
    const updateCount = prepared.staged.length - newCount;
    const message = "Import summary\\n\\n" +
      "New products: " + newCount + "\\n" +
      "Update existing products: " + updateCount + "\\n" +
      "Invalid/duplicate rows skipped: " + prepared.invalid + "\\n\\n" +
      "Continue? Existing products with a matching SKU (or name/category when SKU is blank) will be updated.";
    if (!window.confirm(message)) return;

    let added = 0;
    let updated = 0;
    const now = Date.now();

    for (const entry of prepared.staged) {
      if (entry.existingId) {
        const existing = products.find((product) => product.id === entry.existingId);
        if (!existing) continue;
        const previousQuantity = existing.quantity;
        Object.assign(existing, entry.product, { updatedAt: now });
        if (existing.quantity !== previousQuantity) {
          recordMovement(
            existing,
            existing.quantity - previousQuantity,
            existing.quantity,
            "CSV import adjustment",
            "Quantity updated from " + file.name
          );
        }
        updated += 1;
      } else {
        const product = {
          id: createId(),
          ...entry.product,
          createdAt: now,
          updatedAt: now
        };
        products.unshift(product);
        recordMovement(product, product.quantity, product.quantity, "CSV import opening balance", "Imported from " + file.name);
        added += 1;
      }
    }

    const saved = saveState();
    render();
    showToast(saved
      ? "Import complete: " + added + " added, " + updated + " updated, " + prepared.invalid + " skipped."
      : "Import applied on screen, but the browser could not save all changes.");
  } catch (error) {
    console.warn("Could not import inventory CSV.", error);
    showToast(error instanceof Error ? error.message : "Could not read this CSV file.");
  }
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 2600);
}

function updateDateLabel() {
  el.todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric"
  }).toLocaleUpperCase();
}

el.form.addEventListener("submit", handleSubmit);
el.cancelEdit.addEventListener("click", () => {
  resetForm();
  el.name.focus();
});
el.search.addEventListener("input", render);
el.sort.addEventListener("change", render);
el.categoryFilter.addEventListener("change", render);
el.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    render();
  });
});
el.exportButton.addEventListener("click", exportCsv);
el.importButton.addEventListener("click", () => el.importFile.click());
el.importFile.addEventListener("change", handleCsvImport);
el.exportHistoryButton.addEventListener("click", exportMovementHistory);
el.emptyAction.addEventListener("click", () => {
  if (products.length === 0) {
    el.name.focus();
    return;
  }
  el.search.value = "";
  el.categoryFilter.value = "all";
  activeFilter = "all";
  render();
  el.search.focus();
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

  if (event.key === "/" && !isTyping && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    el.search.focus();
  }
  if (event.key === "Escape" && document.activeElement === el.search) {
    el.search.value = "";
    render();
    el.search.blur();
  }
});

updateDateLabel();
render();
