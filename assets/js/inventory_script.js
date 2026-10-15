const $ = (id) => document.getElementById(id);
const ADMIN_KEY = "robkit_admin";
let dt;
const PREFIX = {
  Microcontroller: "U",
  Sensor: "S",
  Actuator: "M",
  Passive: "P",
  Display: "D",
  Power: "B",
  Cable: "W",
  Tool: "T",
  Kit: "K",
  Other: "X",
};

let items = [];
let loans = [];
let itemModal, borrowModal, loginModal;
let isAdmin = false;
let adminHash = null;
const PAGE_SIZE = 10;
let currentPage = 1;

/* SUPABASE */
const SUPABASE_URL = "https://tnvofnpkqoaituwkzxcm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRudm9mbnBrcW9haXR1d2t6eGNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMzYwNTMsImV4cCI6MjA5OTgxMjA1M30._qAitIIaFr5MTbgof3MZuF19kG2W4IZnvu3A4yXL1sg";

const supabaseClient = SUPABASE_URL.startsWith("http")
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function checkConfigured() {
  if (!supabaseClient) {
    alert("Supabase isn't configured yet.");
    return false;
  }
  return true;
}

/* DATE HELPERS (local time, YYYY-MM-DD) */
function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}
function addDays(str, n) {
  const d = new Date(str + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

/* LOAD DATA */
async function loadData() {
  if (!checkConfigured()) return;

  const { data: itemRows, error: itemErr } = await supabaseClient
    .from("items")
    .select("*")
    .order("name");

  if (itemErr) {
    console.error("Load items failed:", itemErr);
    items = [];
  } else {
    items = itemRows.map((r) => ({
      id: r.id,
      ref: r.ref,
      name: r.name,
      category: r.category,
      location: r.location,
      qty: r.qty,
      min: r.min,
      notes: r.notes,
      consumable: r.consumable,
    }));
  }

  const { data: loanRows, error: loanErr } = await supabaseClient
    .from("loans")
    .select("*")
    .order("date", { ascending: false });

  if (loanErr) {
    console.error("Load loans failed:", loanErr);
    loans = [];
  } else {
    loans = loanRows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemRef: r.item_ref,
      itemName: r.item_name,
      borrower: r.borrower,
      qty: r.qty,
      date: r.date,
      dueDate: r.due_date,
      purpose: r.purpose,
    }));
  }

  const { data: adminRow } = await supabaseClient
    .from("admin_settings")
    .select("password_hash")
    .eq("id", 1)
    .maybeSingle();
  adminHash = adminRow ? adminRow.password_hash : null;
}

function subscribeToChanges() {
  if (!supabaseClient) return;
  const refresh = async () => {
    await loadData();
    render();
  };
  supabaseClient
    .channel("parts-bench-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "items" },
      refresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "loans" },
      refresh,
    )
    .subscribe();
}

/* PASSWORD / LOGIN */
async function hashPassword(password) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password),
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function openLoginModal() {
  if (!checkConfigured()) return;
  $("fPassword").value = "";
  $("loginError").classList.add("d-none");
  loginModal.show();
}

function loginFail(msg) {
  $("loginError").textContent = msg;
  $("loginError").classList.remove("d-none");
}

function grantAdmin() {
  isAdmin = true;
  try {
    sessionStorage.setItem(ADMIN_KEY, adminHash);
  } catch {}
  document.body.classList.add("is-admin");
  render();
  loginModal.hide();
}

async function submitLogin() {
  const password = $("fPassword").value;
  if (!password) return loginFail("Enter a password.");

  if (!adminHash) {
    const newHash = await hashPassword(password);
    const { error } = await supabaseClient
      .from("admin_settings")
      .upsert({ id: 1, password_hash: newHash });
    if (error) return loginFail("Could not save password.");
    adminHash = newHash;
    return grantAdmin();
  }

  if ((await hashPassword(password)) === adminHash) grantAdmin();
  else loginFail("Incorrect password.");
}

function logoutAdmin() {
  isAdmin = false;
  try {
    sessionStorage.removeItem(ADMIN_KEY);
  } catch {}
  document.body.classList.remove("is-admin");
  render();
}

function restoreAdmin() {
  try {
    if (adminHash && sessionStorage.getItem(ADMIN_KEY) === adminHash) {
      isAdmin = true;
      document.body.classList.add("is-admin");
    }
  } catch {}
}

/* HELPERS */
function nextRef(category) {
  const prefix = PREFIX[category] || "X";
  const count = items.filter((i) => i.ref && i.ref.startsWith(prefix)).length;
  return prefix + (count + 1);
}

function itemStatus(item) {
  if (Number(item.qty) <= 0) return "out";
  if (Number(item.qty) <= Number(item.min)) return "low";
  return "ok";
}

function statusLabel(s) {
  return s === "out" ? "Out of Stock" : s === "low" ? "Low Stock" : "In Stock";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

function populateCategoryFilter() {
  const select = $("categoryFilter");
  const current = select.value;
  select.innerHTML =
    '<option value="">All categories</option>' +
    Object.keys(PREFIX)
      .map((c) => `<option value="${c}">${c}</option>`)
      .join("");
  select.value = current;
}

/* RENDER */
function render() {
  const search = $("searchInput").value.trim().toLowerCase();
  const categoryFilter = $("categoryFilter").value;
  const statusFilter = $("statusFilter").value;

  const filtered = items.filter((item) => {
    if (categoryFilter && item.category !== categoryFilter) return false;
    if (statusFilter && itemStatus(item) !== statusFilter) return false;
    if (search) {
      const hay = (
        (item.name || "") +
        " " +
        (item.location || "") +
        " " +
        (item.notes || "")
      ).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  const body = $("itemsBody");
  const empty = $("emptyState");

  if (filtered.length === 0) {
    body.innerHTML = "";
    empty.classList.remove("d-none");
  } else {
    empty.classList.add("d-none");
    body.innerHTML = filtered
      .map((item) => {
        const status = itemStatus(item);
        return `
            <tr>
              <td><span class="ref-badge">${escapeHtml(item.ref)}</span></td>
              <td>
                <div class="item-name">${escapeHtml(item.name)}</div>
                ${item.notes ? `<div class="text-secondary" style="font-size:0.78rem;">${escapeHtml(item.notes)}</div>` : ""}
              </td>
              <td><span class="cat-pill">${escapeHtml(item.category)}</span></td>
              <td>
                <span class="type-pill ${item.consumable ? "consumable" : "reusable"}">
                  ${item.consumable ? "Consumable" : "Reusable"}
                </span>
              </td>
              <td class="item-loc">${escapeHtml(item.location) || "—"}</td>
              <td>
                <div class="qty-control">
                  <button class="qty-btn" onclick="adjustQty('${item.id}', -1)"><i class="bi bi-dash"></i></button>
                  <span class="qty-val">${item.qty}</span>
                  <button class="qty-btn" onclick="adjustQty('${item.id}', 1)"><i class="bi bi-plus"></i></button>
                </div>
              </td>
              <td>
                <span class="status-${status}">
                  <span class="status-dot"></span>
                  <span class="status-text">${statusLabel(status)}</span>
                </span>
              </td>
              <td class="text-end row-actions">
                <button class="btn btn-sm" title="Borrow" onclick="openBorrowModal('${item.id}')"><i class="bi bi-box-arrow-right"></i></button>
                <button class="btn btn-sm admin-only" title="Edit" onclick="openEditModal('${item.id}')"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm admin-only" title="Delete" onclick="deleteItem('${item.id}')"><i class="bi bi-trash"></i></button>
              </td>
            </tr>`;
      })
      .join("");
  }

  /* STATS */
  const totalItems = items.length;
  const totalQty = items.reduce((s, i) => s + Number(i.qty || 0), 0);
  const inStock = items.filter((i) => itemStatus(i) === "ok").length;
  const totalBorrowed = loans.reduce((s, l) => s + Number(l.qty || 0), 0);

  $("statTotalItems").textContent = totalItems;
  $("statTotalQty").textContent = totalQty;
  $("statInStock").textContent = inStock;
  $("statLow").textContent = items.filter(
    (i) => itemStatus(i) === "low",
  ).length;
  $("statOut").textContent = items.filter(
    (i) => itemStatus(i) === "out",
  ).length;
  $("statBorrowed").textContent = totalBorrowed;
  $("statCategories").textContent = new Set(items.map((i) => i.category)).size;
  $("statConsumable").textContent = items.filter((i) => i.consumable).length;
  $("statStockHealth").textContent =
    (totalItems > 0 ? Math.round((inStock / totalItems) * 100) : 0) + "%";
  $("statAvailableUnits").textContent = totalQty;
  $("navLoanCount").textContent = loans.length;
}

/* BORROW */
function openBorrowModal(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  $("borrowItemId").value = id;
  $("borrowItemInfo").textContent =
    `${item.ref} — ${item.name} · ${item.qty} in stock`;
  $("fBorrower").value = "";
  $("fBorrowQty").value = 1;
  $("fBorrowQty").max = item.qty;
  $("fBorrowDate").value = todayStr();
  $("fDueDate").value = addDays(todayStr(), 7);
  $("fPurpose").value = "";
  $("borrowError").classList.add("d-none");

  $("loanFields").classList.toggle("d-none", !!item.consumable);
  $("consumableNote").classList.toggle("d-none", !item.consumable);

  borrowModal.show();
}

function borrowFail(msg) {
  $("borrowError").textContent = msg;
  $("borrowError").classList.remove("d-none");
}

async function confirmBorrow() {
  const item = items.find((i) => i.id === $("borrowItemId").value);
  if (!item) return;

  const qty = Math.max(1, parseInt($("fBorrowQty").value) || 1);
  const borrower = $("fBorrower").value.trim();
  const borrowedOn = $("fBorrowDate").value;
  const dueDate = $("fDueDate").value;
  const purpose = $("fPurpose").value.trim();

  if (!borrower) return borrowFail("Enter the borrower's name.");
  if (qty > item.qty) return borrowFail(`Only ${item.qty} item(s) available.`);

  if (!item.consumable) {
    if (!borrowedOn) return borrowFail("Pick the date borrowed.");
    if (!dueDate) return borrowFail("Pick a return date.");
    if (dueDate < borrowedOn)
      return borrowFail("Return date cannot be before the borrow date.");
    if (!purpose) return borrowFail("Enter the purpose.");
  }

  const newQty = item.qty - qty;
  let loan = null;

  if (!item.consumable) {
    loan = {
      id: "loan-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      item_id: item.id,
      item_ref: item.ref,
      item_name: item.name,
      borrower,
      qty,
      date: borrowedOn,
      due_date: dueDate,
      purpose,
    };
    const { error: loanError } = await supabaseClient
      .from("loans")
      .insert(loan);
    if (loanError) {
      console.error(loanError);
      return borrowFail("Could not save the loan.");
    }
  }

  const { error: updateError } = await supabaseClient
    .from("items")
    .update({ qty: newQty })
    .eq("id", item.id);

  if (updateError) {
    console.error(updateError);
    if (loan) await supabaseClient.from("loans").delete().eq("id", loan.id); // roll back
    return borrowFail("Could not update stock.");
  }

  item.qty = newQty;
  if (loan) {
    loans.push({
      id: loan.id,
      itemId: loan.item_id,
      itemRef: loan.item_ref,
      itemName: loan.item_name,
      borrower,
      qty,
      date: borrowedOn,
      dueDate,
      purpose,
    });
  }

  render();
  borrowModal.hide();
}

/* FILTERS */
function clearFilters() {
  $("searchInput").value = "";
  $("categoryFilter").value = "";
  $("statusFilter").value = "";
  render();
}

/* ADD / EDIT / SAVE */
function openAddModal() {
  if (!isAdmin) return;
  $("modalTitle").textContent = "Add Item";
  $("itemId").value = "";
  $("fName").value = "";
  $("fCategory").value = "Sensor";
  $("fLocation").value = "";
  $("fQty").value = 1;
  $("fMin").value = 2;
  $("fNotes").value = "";
  $("fConsumable").checked = false;
}

function openEditModal(id) {
  if (!isAdmin) return;
  const item = items.find((i) => i.id === id);
  if (!item) return;

  $("modalTitle").textContent = `Edit ${item.ref} — ${item.name}`;
  $("itemId").value = item.id;
  $("fName").value = item.name;
  $("fCategory").value = item.category;
  $("fLocation").value = item.location || "";
  $("fQty").value = item.qty;
  $("fMin").value = item.min;
  $("fNotes").value = item.notes || "";
  $("fConsumable").checked = !!item.consumable;
  itemModal.show();
}

async function saveItem() {
  if (!isAdmin) return;

  const id = $("itemId").value;
  const name = $("fName").value.trim();
  if (!name) {
    $("fName").focus();
    return;
  }

  const fields = {
    name,
    category: $("fCategory").value,
    location: $("fLocation").value.trim(),
    qty: Math.max(0, parseInt($("fQty").value) || 0),
    min: Math.max(0, parseInt($("fMin").value) || 0),
    notes: $("fNotes").value.trim(),
    consumable: $("fConsumable").checked,
  };

  if (id) {
    const { error } = await supabaseClient
      .from("items")
      .update(fields)
      .eq("id", id);
    if (error) {
      console.error(error);
      return;
    }
    const item = items.find((i) => i.id === id);
    if (item) Object.assign(item, fields);
  } else {
    const newItem = {
      id: "itm-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      ref: nextRef(fields.category),
      ...fields,
    };
    const { error } = await supabaseClient.from("items").insert(newItem);
    if (error) {
      console.error(error);
      return;
    }
    items.push(newItem);
  }

  render();
  itemModal.hide();
}

async function adjustQty(id, delta) {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  const newQty = Math.max(0, Number(item.qty || 0) + delta);
  const { error } = await supabaseClient
    .from("items")
    .update({ qty: newQty })
    .eq("id", id);
  if (error) {
    console.error(error);
    return;
  }

  item.qty = newQty;
  render();
}

async function deleteItem(id) {
  if (!isAdmin) return;
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (!confirm(`Remove ${item.ref} — ${item.name} from inventory?`)) return;

  const { error } = await supabaseClient.from("items").delete().eq("id", id);
  if (error) {
    console.error(error);
    return;
  }

  items = items.filter((i) => i.id !== id);
  render();
}

/* EVENTS */
$("searchInput").addEventListener("input", render);
$("categoryFilter").addEventListener("change", render);
$("statusFilter").addEventListener("change", render);
$("fPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitLogin();
});

/* INIT */
(async function init() {
  itemModal = new bootstrap.Modal($("itemModal"));
  borrowModal = new bootstrap.Modal($("borrowModal"));
  loginModal = new bootstrap.Modal($("loginModal"));

  populateCategoryFilter();

  if (checkConfigured()) {
    await loadData();
    restoreAdmin(); // <-- add this line
    subscribeToChanges();
  }
  render();
})();
