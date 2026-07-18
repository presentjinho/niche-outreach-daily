/* Niche Outreach Daily — static / GitHub Pages (localStorage) */
const LS_ACCOUNTS = "nod_v1_accounts";
const LS_STATE = "nod_v1_state";
const LS_CONFIG = "nod_v1_config";

const DEFAULT_CONFIG = {
  app_name: "Niche Outreach Daily",
  niche_label: "AI / 크리에이터",
  language: "ko",
};

const DEFAULT_STATE = () => ({
  following: [],
  skip: [],
  meta: {},
  history: {},
  daily_size: 20,
  cooldown_days: 14,
  last_batch_date: "",
  last_batch: [],
});

const $ = (s) => document.querySelector(s);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysSince(iso) {
  if (!iso) return 9999;
  try {
    const d = new Date(iso.slice(0, 10) + "T12:00:00");
    const t = new Date(todayStr() + "T12:00:00");
    return Math.floor((t - d) / 86400000);
  } catch {
    return 9999;
  }
}

function normHandle(h) {
  h = String(h || "").trim();
  if (h.startsWith("@")) h = h.slice(1);
  h = h.split("/").pop().split("?")[0];
  return h.trim();
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return typeof fallback === "function" ? fallback() : structuredClone(fallback);
    return JSON.parse(raw);
  } catch {
    return typeof fallback === "function" ? fallback() : structuredClone(fallback);
  }
}

function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pickBatch(accounts, state, force) {
  const today = todayStr();
  const size = Number(state.daily_size) || 20;
  const cooldown = Number(state.cooldown_days) || 14;
  const following = new Set(state.following || []);
  const skip = new Set(state.skip || []);
  const meta = state.meta || (state.meta = {});
  const history = state.history || (state.history = {});

  if (!force && state.last_batch_date === today && state.last_batch?.length) {
    return [...state.last_batch];
  }

  const candidates = [];
  for (const a of accounts) {
    const h = normHandle(a.handle);
    if (!h || following.has(h) || skip.has(h)) continue;
    const m = meta[h] || {};
    const last = m.last_shown || "";
    if (m.hearted && m.replied && daysSince(last) < cooldown) continue;
    const tierW = { core: 0, mid: 1, growth: 2, edge: 3 }[a.tier] ?? 2;
    const shownCount = Number(history[h]?.shown || 0);
    const score =
      tierW * 100 +
      shownCount * 10 +
      (last ? Math.min(daysSince(last), 30) : 0) +
      (m.hearted && m.replied ? 50 : 0);
    candidates.push([score, h]);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  let batch = candidates.slice(0, size).map((x) => x[1]);

  if (batch.length < size) {
    for (const a of accounts) {
      if (batch.length >= size) break;
      const h = normHandle(a.handle);
      if (!h || following.has(h) || skip.has(h) || batch.includes(h)) continue;
      const m = meta[h] || {};
      const last = m.last_shown || "";
      if (!last || daysSince(last) >= cooldown) batch.push(h);
    }
  }

  state.last_batch_date = today;
  state.last_batch = batch;
  for (const h of batch) {
    const m = meta[h] || (meta[h] = {});
    m.last_shown = today;
    const hist = history[h] || (history[h] = { shown: 0, days: [] });
    hist.shown = Number(hist.shown || 0) + 1;
    if (!hist.days.includes(today)) {
      hist.days.push(today);
      hist.days = hist.days.slice(-60);
    }
  }
  state.meta = meta;
  state.history = history;
  return batch;
}

let store = {
  accountsDoc: { version: 2, pack_name: "", note: "", accounts: [] },
  state: DEFAULT_STATE(),
  config: { ...DEFAULT_CONFIG },
};
let currentItems = [];

function persist() {
  saveJSON(LS_ACCOUNTS, store.accountsDoc);
  saveJSON(LS_STATE, store.state);
  saveJSON(LS_CONFIG, store.config);
}

function pill(label, val, cls = "") {
  return `<span class="pill ${cls}">${label} <b>${val}</b></span>`;
}

function renderStats(stats) {
  $("#stats").innerHTML = [
    pill("풀", stats.pool),
    pill("오늘", stats.batch, "accent"),
    pill("하트", `${stats.hearted}/${stats.batch}`),
    pill("댓글", `${stats.replied}/${stats.batch}`),
    pill("둘 다", `${stats.complete}/${stats.batch}`, "good"),
    pill("팔로잉 제외", stats.following),
  ].join("");
  const pct = stats.batch ? Math.round((stats.complete / stats.batch) * 100) : 0;
  $("#bar").style.width = `${pct}%`;
  $("#dailySize").value = stats.daily_size;
  $("#cooldown").value = stats.cooldown_days;
}

function applyConfig(cfg) {
  const name = cfg.app_name || DEFAULT_CONFIG.app_name;
  $("#appTitle").textContent = name;
  document.title = name;
  $("#nicheLabel").textContent = cfg.niche_label || "니치";
  $("#cfgAppName").value = cfg.app_name || "";
  $("#cfgNiche").value = cfg.niche_label || "";
}

function cardHtml(item, idx) {
  const done = item.hearted && item.replied;
  const tags = (item.tags || []).map((t) => `<span class="tag">#${t}</span>`).join("");
  const tier = item.tier || "mid";
  return `
  <article class="card ${done ? "done" : ""}" data-handle="${item.handle}">
    <div class="card-top">
      <div>
        <div class="handle"><a href="${item.profile}" target="_blank" rel="noopener">@${item.handle}</a></div>
        <div class="name">${escapeHtml(item.name || "")} · #${idx + 1}</div>
      </div>
      <span class="tier ${tier}">${tier}</span>
    </div>
    <div class="note">${escapeHtml(item.note || "")}</div>
    <div class="tags">${tags}</div>
    <div class="links">
      <a class="btn" href="${item.profile}" target="_blank" rel="noopener">프로필</a>
      <a class="btn" href="https://x.com/${item.handle}" target="_blank" rel="noopener">타임라인</a>
      <button type="button" data-act="following">팔로우함</button>
      <button type="button" data-act="skip">스킵</button>
    </div>
    <div class="actions">
      <label class="chk ${item.hearted ? "on" : ""}">
        <input type="checkbox" data-field="hearted" ${item.hearted ? "checked" : ""} />
        ❤️ 하트
      </label>
      <label class="chk ${item.replied ? "on" : ""}">
        <input type="checkbox" data-field="replied" ${item.replied ? "checked" : ""} />
        💬 댓글
      </label>
    </div>
  </article>`;
}

function buildToday(force = false) {
  const accounts = store.accountsDoc.accounts || [];
  const batch = pickBatch(accounts, store.state, force);
  persist();
  const byH = Object.fromEntries(
    accounts.map((a) => [normHandle(a.handle), a]).filter(([h]) => h)
  );
  const following = new Set(store.state.following || []);
  currentItems = batch.map((h) => {
    const a = byH[h] || { handle: h, name: h, tags: [], note: "" };
    const m = store.state.meta?.[h] || {};
    return {
      ...a,
      handle: h,
      profile: `https://x.com/${h}`,
      hearted: !!m.hearted,
      replied: !!m.replied,
      following: following.has(h),
      last_shown: m.last_shown || "",
    };
  });
  return currentItems;
}

function render() {
  $("#dateLabel").textContent = todayStr();
  applyConfig(store.config);
  const items = currentItems;
  const stats = {
    pool: (store.accountsDoc.accounts || []).length,
    batch: items.length,
    hearted: items.filter((x) => x.hearted).length,
    replied: items.filter((x) => x.replied).length,
    complete: items.filter((x) => x.hearted && x.replied).length,
    following: (store.state.following || []).length,
    daily_size: store.state.daily_size || 20,
    cooldown_days: store.state.cooldown_days || 14,
  };
  renderStats(stats);

  const grid = $("#grid");
  const empty = $("#empty");
  if (!items.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = items.map(cardHtml).join("");
  bindCards();
}

function bindCards() {
  $("#grid").querySelectorAll(".card").forEach((card) => {
    const handle = card.dataset.handle;
    card.querySelectorAll("input[data-field]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const field = inp.dataset.field;
        const meta = store.state.meta || (store.state.meta = {});
        const m = meta[handle] || (meta[handle] = {});
        m[field] = inp.checked;
        if (inp.checked) m[`${field}_at`] = new Date().toISOString();
        persist();
        inp.closest(".chk").classList.toggle("on", inp.checked);
        const hearted = card.querySelector('input[data-field="hearted"]').checked;
        const replied = card.querySelector('input[data-field="replied"]').checked;
        card.classList.toggle("done", hearted && replied);
        const item = currentItems.find((x) => x.handle === handle);
        if (item) {
          item.hearted = hearted;
          item.replied = replied;
        }
        render();
        toast(`@${handle} ${field} ${inp.checked ? "✓" : "—"}`);
      });
    });
    card.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "following") {
          const fl = new Set(store.state.following || []);
          fl.add(handle);
          store.state.following = [...fl].sort();
          toast(`@${handle} 팔로잉 제외`);
        } else if (act === "skip") {
          const sk = new Set(store.state.skip || []);
          sk.add(handle);
          store.state.skip = [...sk].sort();
          toast(`@${handle} 스킵`);
        }
        persist();
        buildToday(true);
        render();
      });
    });
  });
}

async function loadSeedAccounts() {
  try {
    const res = await fetch("./data/accounts.json", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (e) {
    console.warn("seed fetch failed", e);
    return { version: 2, pack_name: "empty", accounts: [] };
  }
}

async function init() {
  const hasLocal = !!localStorage.getItem(LS_ACCOUNTS);
  store.config = { ...DEFAULT_CONFIG, ...loadJSON(LS_CONFIG, DEFAULT_CONFIG) };
  store.state = { ...DEFAULT_STATE(), ...loadJSON(LS_STATE, DEFAULT_STATE) };

  if (hasLocal) {
    store.accountsDoc = loadJSON(LS_ACCOUNTS, { accounts: [] });
  } else {
    store.accountsDoc = await loadSeedAccounts();
    persist();
  }

  // ?pack=https://...
  const params = new URLSearchParams(location.search);
  const packUrl = params.get("pack");
  if (packUrl) {
    try {
      await importPackFromUrl(packUrl, "merge", false);
      toast("URL 팩 로드됨");
    } catch (e) {
      toast("팩 URL 실패: " + e.message);
    }
  }

  buildToday(false);
  render();
}

function mergeAccounts(list, mode) {
  if (mode === "replace") {
    store.accountsDoc.accounts = [];
  }
  const existing = new Map(
    (store.accountsDoc.accounts || []).map((a) => [normHandle(a.handle).toLowerCase(), a])
  );
  let added = 0;
  for (const a of list || []) {
    if (!a || typeof a !== "object") continue;
    const h = normHandle(a.handle);
    if (!h) continue;
    const key = h.toLowerCase();
    const entry = {
      handle: h,
      name: a.name || h,
      tags: a.tags || ["imported"],
      tier: a.tier || "mid",
      verified: !!a.verified,
      note: a.note || "imported",
    };
    if (mode !== "replace" && existing.has(key)) continue;
    if (mode === "replace" || !existing.has(key)) {
      store.accountsDoc.accounts = store.accountsDoc.accounts || [];
      store.accountsDoc.accounts.push(entry);
      existing.set(key, entry);
      added++;
    }
  }
  return added;
}

function parsePack(pack) {
  let accountsList = [];
  let accountsDocMeta = {};
  if (pack.accounts && Array.isArray(pack.accounts)) {
    accountsList = pack.accounts;
  } else if (pack.accounts && typeof pack.accounts === "object") {
    accountsList = pack.accounts.accounts || [];
    accountsDocMeta = pack.accounts;
  } else if (Array.isArray(pack.items)) {
    accountsList = pack.items;
  }
  return { accountsList, accountsDocMeta, config: pack.config, state: pack.state };
}

async function importPackFromUrl(url, mode, withState) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const pack = await res.json();
  applyPackObject(pack, mode, withState);
}

function applyPackObject(pack, mode, withState) {
  const { accountsList, accountsDocMeta, config, state } = parsePack(pack);
  if (accountsDocMeta.pack_name) store.accountsDoc.pack_name = accountsDocMeta.pack_name;
  if (accountsDocMeta.note) store.accountsDoc.note = accountsDocMeta.note;
  if (pack.pack_name) store.accountsDoc.pack_name = pack.pack_name;
  const added = mergeAccounts(accountsList, mode);
  if (config && typeof config === "object") {
    store.config = { ...store.config, ...config };
  }
  if (withState && state && typeof state === "object") {
    store.state = { ...DEFAULT_STATE(), ...state };
  }
  persist();
  buildToday(true);
  render();
  return added;
}

// events
$("#btnRefresh").addEventListener("click", () => {
  buildToday(false);
  render();
  toast("새로고침");
});

$("#btnReshuffle").addEventListener("click", () => {
  if (!confirm("오늘 배치를 다시 뽑을까요?")) return;
  buildToday(true);
  render();
  toast("새 배치");
});

$("#btnOpenAll").addEventListener("click", () => {
  const remain = currentItems.filter((x) => !(x.hearted && x.replied)).slice(0, 5);
  if (!remain.length) return toast("남은 카드 없음");
  remain.forEach((x) => window.open(x.profile, "_blank", "noopener"));
  toast(`${remain.length}탭`);
});

$("#btnExportPack").addEventListener("click", () => {
  const pack = {
    format: "niche-outreach-pack",
    version: 1,
    exported_at: new Date().toISOString(),
    config: store.config,
    accounts: store.accountsDoc,
  };
  downloadJson(`niche-outreach-pack-${todayStr()}.json`, pack);
  toast("팩 다운로드");
});

$("#btnExportFull").addEventListener("click", () => {
  const pack = {
    format: "niche-outreach-pack",
    version: 1,
    exported_at: new Date().toISOString(),
    config: store.config,
    accounts: store.accountsDoc,
    state: store.state,
  };
  downloadJson(`niche-outreach-backup-${todayStr()}.json`, pack);
  toast("백업 다운로드");
});

$("#btnSaveSettings").addEventListener("click", () => {
  store.state.daily_size = Math.max(1, Math.min(50, Number($("#dailySize").value) || 20));
  store.state.cooldown_days = Math.max(1, Math.min(90, Number($("#cooldown").value) || 14));
  persist();
  toast("설정 저장");
});

$("#btnSaveConfig").addEventListener("click", () => {
  store.config.app_name = $("#cfgAppName").value || DEFAULT_CONFIG.app_name;
  store.config.niche_label = $("#cfgNiche").value || DEFAULT_CONFIG.niche_label;
  persist();
  applyConfig(store.config);
  toast("니치/이름 저장");
});

$("#btnImportFollowing").addEventListener("click", () => {
  const text = $("#followingText").value;
  const handles = text
    .replaceAll(",", "\n")
    .split("\n")
    .map(normHandle)
    .filter(Boolean);
  const fl = new Set(store.state.following || []);
  handles.forEach((h) => fl.add(h));
  store.state.following = [...fl].sort();
  persist();
  $("#followingText").value = "";
  buildToday(true);
  render();
  toast(`팔로잉 ${store.state.following.length}`);
});

$("#btnAddAccounts").addEventListener("click", () => {
  const lines = $("#addText").value
    .replaceAll(",", "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const existing = new Set(
    (store.accountsDoc.accounts || []).map((a) => normHandle(a.handle).toLowerCase())
  );
  let added = 0;
  for (const ln of lines) {
    const parts = ln.split(/\s+/);
    const h = normHandle(parts[0]);
    if (!h || existing.has(h.toLowerCase())) continue;
    const tags = parts.slice(1).filter((p) => p.startsWith("#")).map((p) => p.slice(1));
    const name = parts.slice(1).filter((p) => !p.startsWith("#")).join(" ") || h;
    store.accountsDoc.accounts = store.accountsDoc.accounts || [];
    store.accountsDoc.accounts.push({
      handle: h,
      name,
      tags: tags.length ? tags : ["custom"],
      tier: "mid",
      verified: false,
      note: "user-added",
    });
    existing.add(h.toLowerCase());
    added++;
  }
  persist();
  $("#addText").value = "";
  buildToday(true);
  render();
  toast(`+${added}`);
});

$("#btnImportPack").addEventListener("click", () => {
  try {
    const raw = $("#packText").value.trim();
    if (!raw) return toast("JSON 붙여넣기");
    const pack = JSON.parse(raw);
    const mode = document.querySelector('input[name="packMode"]:checked')?.value || "merge";
    const added = applyPackObject(pack, mode, $("#importState").checked);
    $("#packText").value = "";
    toast(`가져옴 +${added}`);
  } catch (e) {
    toast(String(e.message || e));
  }
});

$("#btnLoadPackUrl").addEventListener("click", async () => {
  const url = $("#packUrl").value.trim();
  if (!url) return toast("URL 입력");
  try {
    const mode = document.querySelector('input[name="packMode"]:checked')?.value || "merge";
    await importPackFromUrl(url, mode, $("#importState").checked);
    toast("URL 팩 OK");
  } catch (e) {
    toast("실패: " + e.message);
  }
});

$("#btnResetLocal").addEventListener("click", async () => {
  if (!confirm("이 브라우저의 아웃리치 데이터를 지울까요?")) return;
  localStorage.removeItem(LS_ACCOUNTS);
  localStorage.removeItem(LS_STATE);
  localStorage.removeItem(LS_CONFIG);
  location.reload();
});

init().catch((e) => {
  $("#empty").hidden = false;
  $("#empty").textContent = "초기화 실패: " + e.message;
});
