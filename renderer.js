// renderer.js  (non-module; exposes global choresApp)
const LS_PASS = "chores.pass";
const LS_SALT = "chores.salt";
const LS_DATA = "chores.data";
const LS_REMEMBER = "chores.remember";

const defaultData = {
  children: [
    { id: "arthur", name: "Arthur", chores: [] },
    { id: "alfie",  name: "Alfie",  chores: [] },
    { id: "jack",   name: "Jack",   chores: [] },
    { id: "sophie", name: "Sophie", chores: [] },
  ],
};

window.choresApp = function choresApp() {
  return {
    // ---------- STATE ----------
    activeView: "setup", // setup | lock | main
    period: "current",
    data: structuredClone(defaultData),
    currentChildIndex: 0,

    setupPassword: "",
    setupPassword2: "",
    setupError: false,

    lockPassword: "",
    lockError: false,
    rememberDevice: true,

    showChoreSheet: false,
    showSettingsSheet: false,

    choreForm: { childId: "", title: "", amount: "" },

    payoutText: "",
    rangeText: "",
    bottomNav: "home",

    // ---------- INIT ----------
    async init() {
      // load data
      const raw = localStorage.getItem(LS_DATA);
      if (raw) {
        try { this.data = JSON.parse(raw); } catch { this.data = structuredClone(defaultData); }
      }

      // auth gate
      const hasPass = !!localStorage.getItem(LS_PASS);
      const remembered = localStorage.getItem(LS_REMEMBER) === "1";

      if (!hasPass) {
        this.activeView = "setup";
      } else if (remembered) {
        this.activeView = "main";
        this.renderPeriod();
        this.ensureChoreFormChild();
        (this.$nextTick ? this.$nextTick.bind(this) : (fn)=>setTimeout(fn,0))(() => {
          this.setupObservers();
          this.snapActiveCard();
        });
      } else {
        this.activeView = "lock";
      }
    },

    // ---------- VIEW HELPERS ----------
    renderPeriod() {
      const { start, end } = this.getPeriodRange();
      const short = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      this.rangeText = `${short(start)} → ${short(end)}`;
      this.payoutText = `Showing ${short(start)} → ${short(end)} • Payout on 15th`;
    },

    getPeriodRange() {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();

      if (this.period === "current") {
        return d >= 15
          ? { start: new Date(y, m, 15), end: new Date(y, m + 1, 15) }
          : { start: new Date(y, m - 1, 15), end: new Date(y, m, 15) };
      }
      if (this.period === "month") return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
      return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };
    },

    // ---------- AUTH ----------
    async doSetup() {
      if (!this.setupPassword || this.setupPassword !== this.setupPassword2) {
        this.setupError = true; return;
      }
      this.setupError = false;

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const derived = await this.derivePassword(this.setupPassword, salt);
      localStorage.setItem(LS_PASS, derived);
      localStorage.setItem(LS_SALT, this.arrayBufferToBase64(salt));

      if (!localStorage.getItem(LS_DATA)) localStorage.setItem(LS_DATA, JSON.stringify(this.data));

      localStorage.setItem(LS_REMEMBER, "1");
      this.activeView = "main";
      this.renderPeriod();
      this.ensureChoreFormChild();
      (this.$nextTick ? this.$nextTick.bind(this) : (fn)=>setTimeout(fn,0))(() => {
        this.setupObservers();
        this.snapActiveCard();
      });
    },

    async doUnlock() {
      const stored = localStorage.getItem(LS_PASS);
      const saltB64 = localStorage.getItem(LS_SALT);
      if (!stored || !saltB64) { this.activeView = "setup"; return; }

      const salt = this.base64ToArrayBuffer(saltB64);
      const derived = await this.derivePassword(this.lockPassword, salt);

      if (derived === stored) {
        this.lockError = false;
        if (this.rememberDevice) localStorage.setItem(LS_REMEMBER, "1");
        else localStorage.removeItem(LS_REMEMBER);

        const raw = localStorage.getItem(LS_DATA);
        if (raw) { try { this.data = JSON.parse(raw); } catch { this.data = structuredClone(defaultData); } }

        this.activeView = "main";
        this.renderPeriod();
        this.ensureChoreFormChild();
        (this.$nextTick ? this.$nextTick.bind(this) : (fn)=>setTimeout(fn,0))(() => {
          this.setupObservers();
          this.snapActiveCard();
        });
      } else {
        this.lockError = true;
      }
    },

    lockOut() {
      localStorage.removeItem(LS_REMEMBER);
      this.lockPassword = "";
      this.activeView = "lock";
    },

    resetDevice() {
      if (confirm("Reset this device and clear password + chores?")) {
        localStorage.removeItem(LS_PASS);
        localStorage.removeItem(LS_SALT);
        localStorage.removeItem(LS_DATA);
        localStorage.removeItem(LS_REMEMBER);
        this.data = structuredClone(defaultData);
        this.currentChildIndex = 0;
        this.activeView = "setup";
      }
    },

    // ---------- DATA ----------
    saveData() {
      localStorage.setItem(LS_DATA, JSON.stringify(this.data));
      this.renderPeriod();
    },

    ensureChoreFormChild() {
      if (this.data.children.length)
        this.choreForm.childId = this.data.children[this.currentChildIndex].id;
    },

    // ---------- CHILDREN ----------
    setCurrentChild(idx) {
      this.currentChildIndex = idx;
      this.ensureChoreFormChild();
      this.highlightCard(idx);
    },

    totalForChildInPeriod(child) {
      const { start, end } = this.getPeriodRange();
      return child.chores
        .filter(c => { const d = new Date(c.date); return d >= start && d < end; })
        .reduce((sum, c) => sum + (c.amount || 0), 0);
    },

    // ---------- CHORES ----------
    addChore() {
      const title = this.choreForm.title.trim();
      const amount = parseFloat(this.choreForm.amount || "0");
      const childId = this.choreForm.childId;
      if (!title || !childId) return;

      const child = this.data.children.find(c => c.id === childId);
      if (!child) return;

      child.chores.push({
        id: "ch_" + crypto.randomUUID(),
        title,
        amount: isNaN(amount) ? 0 : amount,
        date: new Date().toISOString(),
      });

      this.saveData();
      this.closeChoreSheet();
      this.choreForm.title = ""; this.choreForm.amount = "";
    },

    removeChore(childId, choreId) {
      const child = this.data.children.find(c => c.id === childId);
      if (!child) return;
      child.chores = child.chores.filter(c => c.id !== choreId);
      this.saveData();
    },

    // ---------- DERIVED ----------
    get currentChildName() {
      return this.data.children[this.currentChildIndex]
        ? this.data.children[this.currentChildIndex].name
        : "—";
    },

    get currentChildChores() {
      const child = this.data.children[this.currentChildIndex];
      if (!child) return [];
      const { start, end } = this.getPeriodRange();
      return child.chores
        .filter(c => { const d = new Date(c.date); return d >= start && d < end; })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    get recentActivity() {
      const all = [];
      this.data.children.forEach(child => {
        child.chores.forEach(c => all.push({ child: child.name, ...c }));
      });
      all.sort((a, b) => new Date(b.date) - new Date(a.date));
      return all.slice(0, 10);
    },

    // ---------- SHEETS ----------
    openChoreSheet() {
      this.showChoreSheet = true;
      this.showSettingsSheet = false;
      this.ensureChoreFormChild();
      document.body.style.overflow = "hidden";
    },
    closeChoreSheet() {
      this.showChoreSheet = false;
      if (!this.showSettingsSheet) document.body.style.overflow = "";
    },
    openSettingsSheet() {
      this.showSettingsSheet = true;
      this.showChoreSheet = false;
      document.body.style.overflow = "hidden";
      this.bottomNav = "device";
    },
    closeSettingsSheet() {
      this.showSettingsSheet = false;
      if (!this.showChoreSheet) document.body.style.overflow = "";
      this.bottomNav = "home";
    },

    // ---------- NAV ----------
    goHome() {
      this.bottomNav = "home";
      const top = document.querySelector(".hero-section");
      if (top) top.scrollIntoView({ behavior: "smooth", block: "start" });
      this.closeSettingsSheet();
    },
    scrollToActivity() {
      this.bottomNav = "activity";
      const block = document.getElementById("activity-section");
      if (block) block.scrollIntoView({ behavior: "smooth", block: "start" });
      this.closeSettingsSheet();
    },

    // ---------- UI Polishing ----------
    setupObservers() {
      const hero = document.getElementById("hero");
      const activity = document.getElementById("activity-section");
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.showSettingsSheet) {
            if (entry.target.id === "hero") this.bottomNav = "home";
            else if (entry.target.id === "activity-section") this.bottomNav = "activity";
          }
        });
      }, { root: document.getElementById("main-scroll"), threshold: 0.55 });
      if (hero) io.observe(hero);
      if (activity) io.observe(activity);

      const carousel = document.getElementById("child-carousel");
      if (carousel) {
        carousel.addEventListener("scroll", this.snapActiveCard.bind(this), { passive: true });
        window.addEventListener("resize", this.snapActiveCard.bind(this));
      }
    },

    snapActiveCard() {
      const carousel = document.getElementById("child-carousel");
      if (!carousel) return;
      const cards = [...carousel.querySelectorAll(".child-card-hero")];
      if (!cards.length) return;

      const centerX = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
      let bestIdx = 0, bestDist = Number.POSITIVE_INFINITY;
      cards.forEach((card, idx) => {
        const rect = card.getBoundingClientRect();
        const cardCenter = rect.left + rect.width / 2;
        const dist = Math.abs(centerX - cardCenter);
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
      });
      if (bestIdx !== this.currentChildIndex) this.setCurrentChild(bestIdx);
      this.highlightCard(bestIdx);
    },

    highlightCard(idx) {
      const carousel = document.getElementById("child-carousel");
      if (!carousel) return;
      carousel.querySelectorAll(".child-card-hero").forEach((el, i) => {
        if (i === idx) el.classList.add("active"); else el.classList.remove("active");
      });
    },

    // ---------- FORMAT ----------
    formatMoney(val){ const num = Number(val || 0); return `£${num.toFixed(2)}`; },
    formatDateTime(isostr){ return new Date(isostr).toLocaleString(); },

    // ---------- CRYPTO ----------
    async derivePassword(password, salt) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt, iterations:100000, hash:"SHA-256" }, keyMaterial, 256);
      return this.bufferToHex(bits);
    },
    arrayBufferToBase64(buf){ const bytes=new Uint8Array(buf); let binary=""; bytes.forEach(b=>binary+=String.fromCharCode(b)); return btoa(binary); },
    base64ToArrayBuffer(b64){ const bin=atob(b64); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer; },
    bufferToHex(buffer){ const bytes=new Uint8Array(buffer); return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join(""); },
  };
};
