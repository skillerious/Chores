// renderer.js  (non-module; exposes global choresApp)
const LS_PASS = "chores.pass";
const LS_SALT = "chores.salt";
const LS_DATA = "chores.data";
const LS_REMEMBER = "chores.remember";
const LS_TOKEN = "chores.github.token";
const LS_PASS_CACHE = "chores.pass.cache";

const defaultData = {
  version: 1,
  children: [
    { id: "arthur", name: "Arthur", balance: 0, chores: [] },
    { id: "alfie",  name: "Alfie",  balance: 0, chores: [] },
    { id: "jack",   name: "Jack",   balance: 0, chores: [] },
    { id: "sophie", name: "Sophie", balance: 0, chores: [] },
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
    setupGithubToken: "",
    setupTokenError: "",

    lockPassword: "",
    lockError: false,
    lockGithubToken: "",
    lockTokenError: "",
    rememberDevice: true,
    hasStoredToken: false,
    requestLockToken: false,

    showChoreSheet: false,
    showSettingsSheet: false,
    showDeleteDialog: false,

    choreForm: { childId: "", title: "", amount: "" },

    payoutText: "",
    rangeText: "",
    bottomNav: "home",
    navBeforeSheet: "home",
    mainScrollEl: null,
    heroScrollAnchor: 80,
    forceCompactHeader: false,
    topbarObserver: null,
    boundResizeHandler: null,
    topbarCompact: false,
    pendingDelete: null,

    githubToken: "",
    githubStatus: { state: "idle", message: "Not connected", lastSync: null },
    remoteLedgerSha: null,
    pendingSyncHandle: null,
    syncReason: "",
    isManualSaving: false,
    saveFeedback: { visible: false, text: "", tone: "success" },
    saveFeedbackTimer: null,
    repoConfig: Object.freeze({
      owner: (window.choreDataConfig && window.choreDataConfig.owner) || "skillerious",
      repo: (window.choreDataConfig && window.choreDataConfig.repo) || "Chores",
      branch: (window.choreDataConfig && window.choreDataConfig.branch) || "main",
      ledgerFile: (window.choreDataConfig && window.choreDataConfig.ledgerFile) || "accounts/ledger.json",
    }),

    // ---------- INIT ----------
    async init() {
      // load data
      const raw = localStorage.getItem(LS_DATA);
      if (raw) {
        try { this.data = JSON.parse(raw); } catch { this.data = structuredClone(defaultData); }
      }
      const cachedPass = localStorage.getItem(LS_PASS_CACHE);
      const storedToken = localStorage.getItem(LS_TOKEN);
      if (storedToken) {
        this.githubToken = storedToken;
        this.hasStoredToken = true;
        this.lockGithubToken = storedToken;
      }
      const rememberFlag = localStorage.getItem(LS_REMEMBER);
      const remembered = rememberFlag === "1";
      this.rememberDevice = rememberFlag === null ? this.rememberDevice : remembered;
      if (remembered && cachedPass) this.lockPassword = cachedPass;
      else if (!remembered) this.lockPassword = "";

      // auth gate
      const hasPass = !!localStorage.getItem(LS_PASS);
      if (!hasPass) {
        this.activeView = "setup";
        if (!storedToken) this.requestLockToken = true;
      } else if (remembered && storedToken) {
        this.activateMain("auto-login");
      } else {
        this.activeView = "lock";
        if (!storedToken) this.requestLockToken = true;
      }
    },

    activateMain(reason = "login") {
      this.activeView = "main";
      this.renderPeriod();
      this.ensureChoreFormChild();
      (this.$nextTick ? this.$nextTick.bind(this) : (fn)=>setTimeout(fn,0))(() => {
        this.setupObservers();
        this.snapActiveCard();
        this.mainScrollEl = document.getElementById("main-scroll");
        this.measureHeaderAnchors();
        this.observeTopbar();
        this.handleViewportResize();
        if (this.mainScrollEl) this.handleMainScroll({ target: this.mainScrollEl });
      });
      if (this.githubToken) {
        this.pullLatestLedger(reason);
      } else {
        this.setGithubStatus("warning", "Add your GitHub token to sync household data");
      }
    },

    // ---------- VIEW HELPERS ----------
    renderPeriod() {
      const { start, end } = this.getPeriodRange();
      const short = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      this.rangeText = `${short(start)} - ${short(end)}`;
      this.payoutText = `Showing ${short(start)} - ${short(end)} | Payout on 15th`;
    },

    handleMainScroll(event) {
      const offset = event?.target ? event.target.scrollTop || 0 : 0;
      const shouldCompact = this.forceCompactHeader || offset > this.headerScrollThreshold();
      if (shouldCompact !== this.topbarCompact) this.topbarCompact = shouldCompact;
    },

    headerScrollThreshold() {
      const clamp = Math.max(60, Math.min(this.heroScrollAnchor - 20, 140));
      return this.forceCompactHeader ? 12 : clamp;
    },

    measureHeaderAnchors() {
      const hero = document.getElementById("hero");
      const main = this.mainScrollEl || document.getElementById("main-scroll");
      if (!hero || !main) return;
      const offset = hero.offsetTop || 0;
      if (offset) this.heroScrollAnchor = offset;
    },

    handleViewportResize() {
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      const forced = height < 640 || width < 360;
      if (forced !== this.forceCompactHeader) this.forceCompactHeader = forced;
      if (!this.mainScrollEl) this.mainScrollEl = document.getElementById("main-scroll");
      this.measureHeaderAnchors();
      this.handleMainScroll({ target: this.mainScrollEl || { scrollTop: 0 } });
    },

    observeTopbar() {
      if (typeof ResizeObserver === "undefined") return;
      const topbar = document.querySelector(".app-topbar");
      if (!topbar) return;
      if (this.topbarObserver) this.topbarObserver.disconnect();
      this.topbarObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          const height = entry?.contentRect?.height || topbar.offsetHeight || 0;
          if (height) document.documentElement.style.setProperty("--app-topbar-height", `${Math.round(height)}px`);
        });
      });
      this.topbarObserver.observe(topbar);
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

      const tokenCandidate = (this.setupGithubToken || "").trim();
      if (!tokenCandidate) {
        this.setupTokenError = "GitHub token is required to store household data.";
        return;
      }
      try {
        await this.applyGithubToken(tokenCandidate, true);
        this.setupTokenError = "";
      } catch (err) {
        this.setupTokenError = err?.message || "Unable to verify GitHub token.";
        return;
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const derived = await this.derivePassword(this.setupPassword, salt);
      localStorage.setItem(LS_PASS, derived);
      localStorage.setItem(LS_SALT, this.arrayBufferToBase64(salt));
      localStorage.setItem(LS_PASS_CACHE, this.setupPassword);
      this.lockPassword = this.setupPassword;

      if (!localStorage.getItem(LS_DATA)) localStorage.setItem(LS_DATA, JSON.stringify(this.data));

      localStorage.setItem(LS_REMEMBER, "1");
      this.rememberDevice = true;
      this.activateMain("first-run");
    },

    async doUnlock() {
      const stored = localStorage.getItem(LS_PASS);
      const saltB64 = localStorage.getItem(LS_SALT);
      if (!stored || !saltB64) { this.activeView = "setup"; return; }

      const salt = this.base64ToArrayBuffer(saltB64);
      const derived = await this.derivePassword(this.lockPassword, salt);

      if (derived === stored) {
        this.lockError = false;
        const storedToken = localStorage.getItem(LS_TOKEN);
        const tokenNeeded = this.requestLockToken || !storedToken;
        if (tokenNeeded) {
          const lockToken = (this.lockGithubToken || "").trim();
          if (!lockToken) {
            this.lockTokenError = "Enter your GitHub token to continue.";
            return;
          }
          try {
            await this.applyGithubToken(lockToken, true);
            this.lockTokenError = "";
          } catch (err) {
            this.lockTokenError = err?.message || "Unable to verify GitHub token.";
            return;
          }
        } else {
          this.githubToken = storedToken;
          this.hasStoredToken = true;
          this.lockTokenError = "";
          this.lockGithubToken = storedToken;
        }
        this.requestLockToken = false;

        if (this.rememberDevice) {
          localStorage.setItem(LS_REMEMBER, "1");
          localStorage.setItem(LS_PASS_CACHE, this.lockPassword);
        } else {
          localStorage.removeItem(LS_REMEMBER);
          localStorage.removeItem(LS_PASS_CACHE);
        }

        const raw = localStorage.getItem(LS_DATA);
        if (raw) { try { this.data = JSON.parse(raw); } catch { this.data = structuredClone(defaultData); } }

        this.activateMain("unlock");
      } else {
        this.lockError = true;
      }
    },

    lockOut(forceForget = false) {
      if (forceForget) {
        localStorage.removeItem(LS_REMEMBER);
        localStorage.removeItem(LS_PASS_CACHE);
        this.rememberDevice = false;
        this.lockPassword = "";
      } else {
        const cached = localStorage.getItem(LS_PASS_CACHE);
        if (this.rememberDevice && cached) this.lockPassword = cached;
        else this.lockPassword = "";
      }
      if (this.githubToken) this.lockGithubToken = this.githubToken;
      this.lockError = false;
      this.lockTokenError = "";
      this.requestLockToken = forceForget || !localStorage.getItem(LS_TOKEN);
      this.activeView = "lock";
    },

    resetDevice() {
      if (confirm("Reset this device and clear password + chores?")) {
        localStorage.removeItem(LS_PASS);
        localStorage.removeItem(LS_SALT);
        localStorage.removeItem(LS_DATA);
        localStorage.removeItem(LS_REMEMBER);
        localStorage.removeItem(LS_PASS_CACHE);
        localStorage.removeItem(LS_TOKEN);
        this.data = structuredClone(defaultData);
        this.currentChildIndex = 0;
        this.githubToken = "";
        this.hasStoredToken = false;
        this.remoteLedgerSha = null;
        if (this.pendingSyncHandle) {
          clearTimeout(this.pendingSyncHandle);
          this.pendingSyncHandle = null;
        }
        this.githubStatus = { state: "idle", message: "Not connected", lastSync: null };
        this.requestLockToken = true;
        this.activeView = "setup";
      }
    },

    // ---------- DATA ----------
    saveData(reason = "Local update") {
      localStorage.setItem(LS_DATA, JSON.stringify(this.data));
      this.renderPeriod();
      this.scheduleRemoteSync(reason);
    },

    scheduleRemoteSync(reason = "Local update") {
      if (!this.githubToken) return;
      if (this.pendingSyncHandle) clearTimeout(this.pendingSyncHandle);
      this.syncReason = reason;
      this.pendingSyncHandle = setTimeout(() => {
        this.pendingSyncHandle = null;
        this.pushLedger(reason);
      }, 800);
    },

    ensureChoreFormChild() {
      if (this.data.children.length)
        this.choreForm.childId = this.data.children[this.currentChildIndex].id;
    },

    // ---------- REMOTE STORAGE ----------
    async applyGithubToken(token, persist = true) {
      const trimmed = (token || "").trim();
      if (!trimmed) throw new Error("GitHub token is required.");
      this.setGithubStatus("verifying", "Verifying GitHub token...");
      let profile;
      try {
        profile = await this.verifyGithubToken(trimmed);
      } catch (err) {
        this.setGithubStatus("error", err?.message || "Unable to verify GitHub token");
        throw err;
      }
      if (persist) localStorage.setItem(LS_TOKEN, trimmed);
      this.githubToken = trimmed;
      this.hasStoredToken = persist;
      this.requestLockToken = false;
      this.lockGithubToken = trimmed;
      this.setupGithubToken = "";
      const login = profile?.login ? `@${profile.login}` : "GitHub";
      this.setGithubStatus("ready", `Connected as ${login}`);
      return profile;
    },

    buildGithubHeaders(token = this.githubToken) {
      if (!token) throw new Error("Missing GitHub token.");
      return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
    },

    ledgerPath() {
      return this.repoConfig.ledgerFile
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");
    },

    contentsUrl(includeRef = true) {
      const { owner, repo, branch } = this.repoConfig;
      const safeOwner = encodeURIComponent(owner);
      const safeRepo = encodeURIComponent(repo);
      const base = `https://api.github.com/repos/${safeOwner}/${safeRepo}/contents/${this.ledgerPath()}`;
      return includeRef ? `${base}?ref=${encodeURIComponent(branch)}` : base;
    },

    setGithubStatus(state, message) {
      const lastSync = state === "synced"
        ? new Date().toISOString()
        : this.githubStatus.lastSync;
      this.githubStatus = { state, message, lastSync };
    },

    async verifyGithubToken(token) {
      let response;
      try {
        response = await fetch("https://api.github.com/user", {
          headers: this.buildGithubHeaders(token),
        });
      } catch (err) {
        throw new Error("Unable to reach GitHub. Check your network connection.");
      }
      if (response.status === 401) throw new Error("GitHub rejected this token.");
      if (!response.ok) throw new Error(`GitHub error (${response.status}).`);
      return response.json();
    },

    async pullLatestLedger(reason = "pull") {
      if (!this.githubToken) {
        this.setGithubStatus("warning", "Add GitHub token to sync data");
        return false;
      }
      this.setGithubStatus("syncing", `Pulling latest (${reason})...`);
      try {
        const res = await fetch(this.contentsUrl(true), {
          headers: this.buildGithubHeaders(),
        });
        if (res.status === 401) {
          throw new Error("GitHub rejected this token. Replace it via Device settings.");
        }
        if (res.status === 404) {
          await this.pushLedger("Initialize ledger");
          return true;
        }
        if (!res.ok) throw new Error(`Unable to read ledger (${res.status}).`);
        const payload = await res.json();
        const decoded = this.base64DecodeString((payload.content || "").replace(/\n/g, ""));
        let parsed;
        try {
          parsed = JSON.parse(decoded);
        } catch {
          throw new Error("Ledger JSON is invalid.");
        }
        if (!parsed || !Array.isArray(parsed.children)) {
          throw new Error("Ledger missing children array.");
        }
        this.remoteLedgerSha = payload.sha || null;
        this.data = parsed;
        localStorage.setItem(LS_DATA, JSON.stringify(parsed));
        this.renderPeriod();
        this.ensureChoreFormChild();
        this.setGithubStatus("synced", "Pulled latest from GitHub");
        return true;
      } catch (err) {
        this.setGithubStatus("error", err?.message || "Failed to pull GitHub data");
        return false;
      }
    },

    async pushLedger(reason = "local update") {
      if (!this.githubToken) {
        this.setGithubStatus("warning", "GitHub token required to sync");
        return false;
      }
      this.setGithubStatus("syncing", `Saving to GitHub (${reason})...`);
      try {
        const payload = JSON.stringify(this.data, null, 2);
        const body = {
          message: `[KidsChores] ${reason}`,
          content: this.base64EncodeString(payload),
          branch: this.repoConfig.branch,
        };
        if (this.remoteLedgerSha) body.sha = this.remoteLedgerSha;
        const res = await fetch(this.contentsUrl(false), {
          method: "PUT",
          headers: this.buildGithubHeaders(),
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          throw new Error("GitHub rejected this token. Replace it via Device settings.");
        }
        if (res.status === 409 || res.status === 422) {
          this.setGithubStatus("warning", "Remote changed. Re-syncing...");
          await this.pullLatestLedger("conflict resolution");
          return false;
        }
        if (!res.ok) throw new Error(`Unable to save ledger (${res.status}).`);
        const result = await res.json();
        this.remoteLedgerSha = result?.content?.sha || this.remoteLedgerSha;
        this.setGithubStatus("synced", "Synced to GitHub");
        return true;
      } catch (err) {
        this.setGithubStatus("error", err?.message || "Failed to save to GitHub");
        return false;
      }
    },

    async syncNow(reason = "Manual sync") {
      if (this.pendingSyncHandle) {
        clearTimeout(this.pendingSyncHandle);
        this.pendingSyncHandle = null;
      }
      return this.pushLedger(reason);
    },

    async refreshFromRemote(reason = "Manual refresh") {
      return this.pullLatestLedger(reason);
    },

    async triggerNavSave() {
      if (!this.githubToken || this.githubStatus.state === "syncing" || this.isManualSaving) return;
      this.isManualSaving = true;
      const ok = await this.syncNow("Bottom nav save");
      if (ok) this.showSaveFeedback("Saved to GitHub", "success");
      else this.showSaveFeedback("Save failed", "error");
      this.isManualSaving = false;
    },

    showSaveFeedback(text, tone = "success") {
      if (this.saveFeedbackTimer) {
        clearTimeout(this.saveFeedbackTimer);
        this.saveFeedbackTimer = null;
      }
      this.saveFeedback = { visible: true, text, tone };
      this.saveFeedbackTimer = setTimeout(() => this.hideSaveFeedback(), 3000);
    },

    hideSaveFeedback() {
      this.saveFeedback = { ...this.saveFeedback, visible: false };
      if (this.saveFeedbackTimer) {
        clearTimeout(this.saveFeedbackTimer);
        this.saveFeedbackTimer = null;
      }
    },

    replaceGithubToken() {
      localStorage.removeItem(LS_TOKEN);
      this.githubToken = "";
      this.hasStoredToken = false;
      this.remoteLedgerSha = null;
      if (this.pendingSyncHandle) {
        clearTimeout(this.pendingSyncHandle);
        this.pendingSyncHandle = null;
      }
      this.requestLockToken = true;
      this.lockGithubToken = "";
      this.lockTokenError = "";
      this.setGithubStatus("warning", "GitHub token removed. Login again to re-link.");
      this.lockOut(true);
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

      this.saveData(`Added chore for ${child.name}`);
      this.closeChoreSheet();
      this.choreForm.title = ""; this.choreForm.amount = "";
    },

    removeChore(childId, choreId) {
      const child = this.data.children.find(c => c.id === childId);
      if (!child) return;
      child.chores = child.chores.filter(c => c.id !== choreId);
      this.saveData(`Removed chore from ${child.name}`);
    },

    promptDeleteChore(childId, chore) {
      if (!chore) return;
      const child = this.data.children.find(c => c.id === childId);
      this.pendingDelete = {
        childId,
        childName: child ? child.name : "",
        choreId: chore.id,
        title: chore.title || "Chore",
        amount: Number(chore.amount || 0),
      };
      this.showChoreSheet = false;
      this.showSettingsSheet = false;
      this.showDeleteDialog = true;
      this.updateBodyScrollLock();
    },
    cancelDeleteChore() {
      this.showDeleteDialog = false;
      this.pendingDelete = null;
      this.updateBodyScrollLock();
    },
    confirmDeleteChore() {
      if (!this.pendingDelete) {
        this.cancelDeleteChore();
        return;
      }
      this.removeChore(this.pendingDelete.childId, this.pendingDelete.choreId);
      this.pendingDelete = null;
      this.showDeleteDialog = false;
      this.updateBodyScrollLock();
    },

    // ---------- DERIVED ----------
    get currentChildName() {
      return this.data.children[this.currentChildIndex]
        ? this.data.children[this.currentChildIndex].name
        : "\u2014";
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
    updateBodyScrollLock() {
      const lock = this.showChoreSheet || this.showSettingsSheet || this.showDeleteDialog;
      document.body.style.overflow = lock ? "hidden" : "";
    },

    openChoreSheet() {
      this.showChoreSheet = true;
      this.showSettingsSheet = false;
      this.showDeleteDialog = false;
      this.pendingDelete = null;
      this.ensureChoreFormChild();
      this.updateBodyScrollLock();
    },
    closeChoreSheet() {
      this.showChoreSheet = false;
      this.updateBodyScrollLock();
    },
    openSettingsSheet() {
      this.navBeforeSheet = this.bottomNav;
      this.showSettingsSheet = true;
      this.showChoreSheet = false;
      this.showDeleteDialog = false;
      this.pendingDelete = null;
      this.updateBodyScrollLock();
      this.bottomNav = "device";
    },
    closeSettingsSheet(targetNav) {
      this.showSettingsSheet = false;
      this.updateBodyScrollLock();
      if (targetNav) this.bottomNav = targetNav;
      else if (this.bottomNav === "device") this.bottomNav = this.navBeforeSheet || "home";
    },

    // ---------- NAV ----------
    goHome() {
      this.bottomNav = "home";
      this.closeSettingsSheet("home");
      this.scrollMainTop();
    },
    scrollToActivity() {
      this.bottomNav = "activity";
      this.closeSettingsSheet("activity");
      this.scrollMainTop();
    },
    scrollMainTop() {
      const main = document.getElementById("main-scroll");
      if (main) main.scrollTo({ top: 0, behavior: "smooth" });
      this.topbarCompact = this.forceCompactHeader;
    },

    // ---------- UI Polishing ----------
    setupObservers() {
      const carousel = document.getElementById("child-carousel");
      if (carousel) {
        carousel.addEventListener("scroll", this.snapActiveCard.bind(this), { passive: true });
        window.addEventListener("resize", this.snapActiveCard.bind(this));
      }
      if (!this.boundResizeHandler) this.boundResizeHandler = this.handleViewportResize.bind(this);
      window.addEventListener("resize", this.boundResizeHandler);
      this.measureHeaderAnchors();
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
      let targetIdx = bestIdx;
      const delta = bestIdx - this.currentChildIndex;
      if (Math.abs(delta) > 1) {
        const direction = Math.sign(delta);
        const nextIdx = Math.min(
          cards.length - 1,
          Math.max(0, this.currentChildIndex + direction)
        );
        targetIdx = nextIdx;
        this.scrollChildCardIntoView(targetIdx, cards);
      }
      if (targetIdx !== this.currentChildIndex) this.setCurrentChild(targetIdx);
      this.highlightCard(targetIdx);
    },

    highlightCard(idx) {
      const carousel = document.getElementById("child-carousel");
      if (!carousel) return;
      carousel.querySelectorAll(".child-card-hero").forEach((el, i) => {
        if (i === idx) el.classList.add("active"); else el.classList.remove("active");
      });
    },
    scrollChildCardIntoView(idx, presetCards) {
      const carousel = document.getElementById("child-carousel");
      if (!carousel) return;
      const cards = presetCards || [...carousel.querySelectorAll(".child-card-hero")];
      const card = cards[idx];
      if (card && card.scrollIntoView) {
        card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    },

    get totalChoresCount() {
      const { start, end } = this.getPeriodRange();
      let count = 0;
      this.data.children.forEach(child => {
        child.chores.forEach(c => {
          const d = new Date(c.date);
          if (d >= start && d < end) count += 1;
        });
      });
      return count;
    },
    get totalChoresValue() {
      const { start, end } = this.getPeriodRange();
      let total = 0;
      this.data.children.forEach(child => {
        child.chores.forEach(c => {
          const d = new Date(c.date);
          if (d >= start && d < end) total += Number(c.amount || 0);
        });
      });
      return total;
    },
    get childBreakdown() {
      const { start, end } = this.getPeriodRange();
      return this.data.children.map(child => {
        let periodTotal = 0;
        let periodCount = 0;
        let last = null;
        let lastDate = null;
        child.chores.forEach(c => {
          const val = Number(c.amount || 0);
          const when = new Date(c.date);
          if (!lastDate || when > lastDate) { last = c; lastDate = when; }
          if (when >= start && when < end) {
            periodTotal += val;
            periodCount += 1;
          }
        });
        return { id: child.id, name: child.name, total: periodTotal, count: periodCount, last };
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
    base64EncodeString(str){ const enc=new TextEncoder(); return this.arrayBufferToBase64(enc.encode(str).buffer); },
    base64DecodeString(b64){ const dec=new TextDecoder(); return dec.decode(this.base64ToArrayBuffer(b64)); },
  };
};
