// renderer.js
const LS_PASS = "chores.pass";
const LS_SALT = "chores.salt";
const LS_DATA = "chores.data";
const LS_REMEMBER = "chores.remember";

const defaultData = {
  children: [
    { id: "arthur", name: "Arthur", chores: [] },
    { id: "alfie", name: "Alfie", chores: [] },
    { id: "jack", name: "Jack", chores: [] },
    { id: "sophie", name: "Sophie", chores: [] },
  ],
};

document.addEventListener("DOMContentLoaded", () => {
  init();
});

async function init() {
  const hasPass = !!localStorage.getItem(LS_PASS);
  const remembered = localStorage.getItem(LS_REMEMBER) === "1";

  if (!hasPass) {
    showView("setup-screen");
  } else if (remembered) {
    await loadMain();
  } else {
    showView("lock-screen");
  }

  // setup
  document.getElementById("setup-save").addEventListener("click", onSetupSave);

  // login
  document.getElementById("lock-unlock").addEventListener("click", attemptUnlock);
  document.getElementById("lock-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptUnlock();
  });
  document.getElementById("lock-reset").addEventListener("click", onResetDevice);

  // main / sheets
  document.getElementById("fab-add").addEventListener("click", () => openChoreSheet());
  document.getElementById("chore-sheet-close").addEventListener("click", () => closeChoreSheet());
  document.getElementById("chore-sheet").addEventListener("click", (e) => {
    if (e.target.dataset.close === "sheet") closeChoreSheet();
  });

  document.getElementById("settings-close").addEventListener("click", () => closeSettingsSheet());
  document.getElementById("settings-sheet").addEventListener("click", (e) => {
    if (e.target.dataset.close === "settings") closeSettingsSheet();
  });
  document.getElementById("settings-reset").addEventListener("click", onResetDevice);

  document.getElementById("chore-form").addEventListener("submit", onAddChore);

  document.getElementById("logout").addEventListener("click", () => {
    closeChoreSheet();
    closeSettingsSheet();
    localStorage.removeItem(LS_REMEMBER);
    showView("lock-screen");
  });

  document.getElementById("period-select").addEventListener("change", () => {
    const data = getData();
    renderAll(data);
  });

  // bottom nav
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => onNavClick(btn));
  });
}

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
  closeChoreSheet();
  closeSettingsSheet();
}

// ---------- SETUP ----------
async function onSetupSave() {
  const pw1 = document.getElementById("setup-password").value.trim();
  const pw2 = document.getElementById("setup-password2").value.trim();
  const err = document.getElementById("setup-error");

  if (!pw1 || pw1 !== pw2) {
    err.classList.remove("hidden");
    return;
  }
  err.classList.add("hidden");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(pw1, salt);
  localStorage.setItem(LS_PASS, derived);
  localStorage.setItem(LS_SALT, arrayBufferToBase64(salt));

  if (!localStorage.getItem(LS_DATA)) {
    localStorage.setItem(LS_DATA, JSON.stringify(defaultData));
  }

  localStorage.setItem(LS_REMEMBER, "1");
  await loadMain();
}

// ---------- LOGIN ----------
async function attemptUnlock() {
  const pwInput = document.getElementById("lock-password").value.trim();
  const err = document.getElementById("lock-error");
  const stored = localStorage.getItem(LS_PASS);
  const saltB64 = localStorage.getItem(LS_SALT);

  if (!stored || !saltB64) {
    showView("setup-screen");
    return;
  }

  const salt = base64ToArrayBuffer(saltB64);
  const derived = await derivePassword(pwInput, salt);

  if (derived === stored) {
    err.classList.add("hidden");

    const remember = document.getElementById("lock-remember").checked;
    if (remember) localStorage.setItem(LS_REMEMBER, "1");
    else localStorage.removeItem(LS_REMEMBER);

    await loadMain();
  } else {
    err.classList.remove("hidden");
  }
}

function onResetDevice() {
  if (confirm("Reset this device and clear password + chores?")) {
    localStorage.removeItem(LS_PASS);
    localStorage.removeItem(LS_SALT);
    localStorage.removeItem(LS_DATA);
    localStorage.removeItem(LS_REMEMBER);
    showView("setup-screen");
  }
}

// ---------- MAIN ----------
async function loadMain() {
  showView("main-screen");
  const data = getData();
  populateChildSelect(data);
  renderAll(data);
}

function getData() {
  const raw = localStorage.getItem(LS_DATA);
  if (!raw) return structuredClone(defaultData);
  try {
    return JSON.parse(raw);
  } catch {
    return structuredClone(defaultData);
  }
}

function saveData(data) {
  localStorage.setItem(LS_DATA, JSON.stringify(data));
  renderAll(data);
}

function renderAll(data) {
  const mode = document.getElementById("period-select").value || "current";
  const { start, end } = getPeriodRange(mode);
  renderChildren(data, start, end);
  renderMetrics(data, start, end);
  renderActivity(data);
  renderPayoutText(start, end);
}

function getPeriodRange(mode) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  if (mode === "current") {
    if (d >= 15) {
      return { start: new Date(y, m, 15), end: new Date(y, m + 1, 15) };
    }
    return { start: new Date(y, m - 1, 15), end: new Date(y, m, 15) };
  }
  if (mode === "month") {
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  }
  return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };
}

function renderChildren(data, start, end) {
  const container = document.getElementById("children-grid");
  container.innerHTML = "";
  data.children.forEach((child) => {
    const choresThisPeriod = child.chores.filter((c) => {
      const d = new Date(c.date);
      return d >= start && d < end;
    });
    const total = choresThisPeriod.reduce((sum, c) => sum + (c.amount || 0), 0);

    const card = document.createElement("div");
    card.className = "child-card";
    card.innerHTML = `
      <div class="child-top">
        <div>
          <div class="child-name">${child.name}</div>
          <div class="child-meta">This period: £${total.toFixed(2)}</div>
        </div>
        <button class="child-add" data-child="${child.id}">+ chore</button>
      </div>
      <div class="chore-list">
        ${
          choresThisPeriod.length
            ? choresThisPeriod
                .map(
                  (c) => `
          <span class="chore-pill">
            <span>${c.title}</span>
            <span class="chore-amt">£${Number(c.amount).toFixed(2)}</span>
            <button class="chore-remove" data-child="${child.id}" data-id="${c.id}">✕</button>
          </span>
        `
                )
                .join("")
            : `<span style="font-size:.57rem;opacity:.4;">No chores logged in this period.</span>`
        }
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll(".child-add").forEach((btn) => {
    btn.addEventListener("click", () => openChoreSheet(btn.dataset.child));
  });
  container.querySelectorAll(".chore-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeChore(btn.dataset.child, btn.dataset.id);
    });
  });
}

function renderMetrics(data, start, end) {
  let totalAll = 0;
  let choresCount = 0;
  let topName = null;
  let topAmount = -1;

  data.children.forEach((child) => {
    const chores = child.chores.filter((c) => {
      const d = new Date(c.date);
      return d >= start && d < end;
    });
    const childTotal = chores.reduce((s, c) => s + (c.amount || 0), 0);
    totalAll += childTotal;
    choresCount += chores.length;
    if (childTotal > topAmount) {
      topAmount = childTotal;
      topName = child.name;
    }
  });

  document.getElementById("metric-total").textContent = `£${totalAll.toFixed(2)}`;
  document.getElementById("metric-chores").textContent = choresCount.toString();
  document.getElementById("metric-active-child").textContent = `${data.children.length} children`;
  document.getElementById("metric-top").textContent = topName ? `${topName} (£${topAmount.toFixed(2)})` : "—";
}

function renderActivity(data) {
  const list = document.getElementById("activity-list");
  list.innerHTML = "";

  const all = [];
  data.children.forEach((child) => {
    child.chores.forEach((c) => {
      all.push({ child: child.name, ...c });
    });
  });

  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  const last10 = all.slice(0, 10);

  if (!last10.length) {
    list.innerHTML = `<p style="font-size:.6rem;opacity:.4;">No chores logged yet.</p>`;
    return;
  }

  last10.forEach((item) => {
    const d = new Date(item.date);
    const el = document.createElement("div");
    el.className = "activity-item";
    el.innerHTML = `
      <div class="activity-left">
        <div class="title">${item.title} • ${item.child}</div>
        <div class="meta">${d.toLocaleString()}</div>
      </div>
      <div class="activity-amt">£${Number(item.amount).toFixed(2)}</div>
    `;
    list.appendChild(el);
  });
}

function renderPayoutText(start, end) {
  const el = document.getElementById("payout-text");
  const opts = { month: "short", day: "numeric" };
  el.textContent = `Showing ${start.toLocaleDateString(undefined, opts)} → ${end.toLocaleDateString(
    undefined,
    opts
  )} • Payout on 15th`;
}

// ---------- SELECT ----------
function populateChildSelect(data) {
  const sel = document.getElementById("chore-child");
  if (!sel) return;
  sel.innerHTML = "";
  data.children.forEach((child) => {
    const opt = document.createElement("option");
    opt.value = child.id;
    opt.textContent = child.name;
    sel.appendChild(opt);
  });
}

// ---------- SHEETS ----------
function anySheetOpen() {
  const chore = document.getElementById("chore-sheet");
  const settings = document.getElementById("settings-sheet");
  return (
    (chore && !chore.classList.contains("hidden")) ||
    (settings && !settings.classList.contains("hidden"))
  );
}

function openChoreSheet(childId) {
  closeSettingsSheet();
  const sheet = document.getElementById("chore-sheet");
  sheet.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (childId) document.getElementById("chore-child").value = childId;
}

function closeChoreSheet() {
  const sheet = document.getElementById("chore-sheet");
  if (sheet && !sheet.classList.contains("hidden")) sheet.classList.add("hidden");
  if (!anySheetOpen()) document.body.style.overflow = "";
}

function openSettingsSheet() {
  closeChoreSheet();
  const sheet = document.getElementById("settings-sheet");
  sheet.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeSettingsSheet() {
  const sheet = document.getElementById("settings-sheet");
  if (sheet && !sheet.classList.contains("hidden")) sheet.classList.add("hidden");
  if (!anySheetOpen()) document.body.style.overflow = "";
}

// add chore
function onAddChore(e) {
  e.preventDefault();
  const data = getData();
  const childId = document.getElementById("chore-child").value;
  const title = document.getElementById("chore-title").value.trim();
  const amount = parseFloat(document.getElementById("chore-amount").value || "0");

  if (!title) return;

  const child = data.children.find((c) => c.id === childId);
  if (!child) return;

  child.chores.push({
    id: "ch_" + crypto.randomUUID(),
    title,
    amount: isNaN(amount) ? 0 : amount,
    date: new Date().toISOString(),
  });

  saveData(data);
  closeChoreSheet();
}

function removeChore(childId, choreId) {
  const data = getData();
  const child = data.children.find((c) => c.id === childId);
  if (!child) return;
  child.chores = child.chores.filter((c) => c.id !== choreId);
  saveData(data);
}

// ---------- NAV ----------
function onNavClick(btn) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  const target = btn.dataset.nav;
  const scroll = document.getElementById("main-scroll");

  if (target === "home") {
    scroll.scrollTo({ top: 0, behavior: "smooth" });
    closeSettingsSheet();
  } else if (target === "activity") {
    const block = document.getElementById("activity-section");
    if (block) block.scrollIntoView({ behavior: "smooth", block: "start" });
    closeSettingsSheet();
  } else if (target === "device") {
    openSettingsSheet();
  }
}

// ---------- CRYPTO ----------
async function derivePassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bufferToHex(bits);
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
