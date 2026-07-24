/* Niche Outreach Daily — static + optional local X API bridge */
const LS_ACCOUNTS = "nod_v2_accounts";
const LS_STATE = "nod_v2_state";

const DEFAULT_STATE = () => ({
  my_handle: "",
  following: [],
  followers: [],
  following_text: "",
  followers_text: "",
  skip: [],
  meta: {},
  history: {},
  daily_size: 20,
  cooldown_days: 14,
  last_batch_date: "",
  last_batch: [],
  related_boost: [],
  saved_at: "",
});

const $ = (s) => document.querySelector(s);
const hasLocalApi = () =>
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost" ||
  location.port === "8766";

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2400);
}

function setSaveStatus(msg, ok = true) {
  const el = $("#saveStatus");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("ok", ok);
  el.classList.toggle("pending", !ok);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    setSaveStatus("저장 중…", false);
    t = setTimeout(() => fn(...args), ms);
  };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  return h.trim().replace(/^https?:\/\/(x|twitter)\.com\//i, "");
}

function parseHandles(text) {
  return [
    ...new Set(
      String(text || "")
        .replaceAll(",", "\n")
        .split(/[\s\n]+/)
        .map(normHandle)
        .filter((h) => h && /^[A-Za-z0-9_]{1,15}$/.test(h))
    ),
  ];
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

function copyText(text) {
  return navigator.clipboard.writeText(text).then(() => true).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  });
}

/** Score related accounts from pool using following overlap + tags */
function scoreRelated(accounts, following, myHandle) {
  const fl = new Set((following || []).map((h) => h.toLowerCase()));
  const me = normHandle(myHandle).toLowerCase();

  // tags from people I already follow who are in the pool
  const tagScore = {};
  for (const a of accounts) {
    const h = normHandle(a.handle).toLowerCase();
    if (!fl.has(h)) continue;
    for (const t of a.tags || []) {
      tagScore[t] = (tagScore[t] || 0) + 2;
    }
    if (a.tier === "core") tagScore["__core"] = (tagScore["__core"] || 0) + 1;
  }

  const scored = [];
  for (const a of accounts) {
    const h = normHandle(a.handle);
    const hl = h.toLowerCase();
    if (!h || hl === me || fl.has(hl)) continue;
    let s = 0;
    for (const t of a.tags || []) s += tagScore[t] || 0;
    if (a.tier === "core") s += 8;
    else if (a.tier === "mid") s += 4;
    else if (a.tier === "growth") s += 2;
    // mild boost if note mentions AI/coding (starter pack)
    const note = (a.note || "") + " " + (a.name || "");
    if (/AI|프롬프트|코딩|영상|툴|agent|Claude|Grok/i.test(note)) s += 2;
    scored.push({ handle: h, score: s, account: a });
  }
  scored.sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
  return scored;
}

function pickBatch(accounts, state, force) {
  const today = todayStr();
  const size = Number(state.daily_size) || 20;
  const cooldown = Number(state.cooldown_days) || 14;
  const following = new Set((state.following || []).map((h) => h.toLowerCase()));
  const skip = new Set((state.skip || []).map((h) => h.toLowerCase()));
  const meta = state.meta || (state.meta = {});
  const history = state.history || (state.history = {});
  const boost = new Map(
    (state.related_boost || []).map((h, i) => [normHandle(h).toLowerCase(), 1000 - i])
  );
  const me = normHandle(state.my_handle || "").toLowerCase();

  if (!force && state.last_batch_date === today && state.last_batch?.length) {
    return [...state.last_batch];
  }

  const candidates = [];
  for (const a of accounts) {
    const h = normHandle(a.handle);
    const hl = h.toLowerCase();
    if (!h || hl === me || following.has(hl) || skip.has(hl)) continue;
    const m = meta[h] || meta[hl] || {};
    const last = m.last_shown || "";
    if (m.hearted && m.replied && daysSince(last) < cooldown) continue;
    const tierW = { core: 0, mid: 1, growth: 2, edge: 3 }[a.tier] ?? 2;
    const shownCount = Number(history[h]?.shown || history[hl]?.shown || 0);
    let score =
      tierW * 100 +
      shownCount * 10 +
      (last ? Math.min(daysSince(last), 30) : 0) +
      (m.hearted && m.replied ? 50 : 0);
    // related boost: lower is better in sort → subtract boost
    score -= boost.get(hl) || 0;
    candidates.push([score, h]);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  let batch = candidates.slice(0, size).map((x) => x[1]);

  if (batch.length < size) {
    for (const a of accounts) {
      if (batch.length >= size) break;
      const h = normHandle(a.handle);
      const hl = h.toLowerCase();
      if (!h || hl === me || following.has(hl) || skip.has(hl) || batch.includes(h)) continue;
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
};
let currentItems = [];
let xBridge = { available: false, xurl: false, authenticated: false };
let externalChangePending = false;

function persist(opts = {}) {
  const silent = !!opts.silent;
  if (externalChangePending) {
    setSaveStatus("다른 탭에서 변경됨 · 여기를 눌러 새로고침", false);
    if (!silent) toast("다른 탭의 최신 변경을 먼저 불러와 주세요");
    return false;
  }
  store.state.saved_at = new Date().toISOString();
  try {
    saveJSON(LS_ACCOUNTS, store.accountsDoc);
    saveJSON(LS_STATE, store.state);
    if (!silent) {
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const ss = String(t.getSeconds()).padStart(2, "0");
      setSaveStatus(`브라우저 자동저장 ${hh}:${mm}:${ss}`, true);
    }
    return true;
  } catch (e) {
    setSaveStatus("저장 실패 (용량/사생활 모드?)", false);
    if (!silent) toast("저장 실패: " + (e.message || e));
    return false;
  }
}

/** Sync inputs → state and write localStorage (debounced callers) */
function autoSaveFromInputs(rebuild = false) {
  const me = normHandle($("#myHandle")?.value || "");
  store.state.my_handle = me;

  if ($("#followingText")) {
    const ft = $("#followingText").value;
    store.state.following_text = ft;
    store.state.following = parseHandles(ft);
  }
  if ($("#followersText")) {
    const ft = $("#followersText").value;
    store.state.followers_text = ft;
    store.state.followers = parseHandles(ft);
  }
  if ($("#dailySize")) {
    store.state.daily_size = Math.max(1, Math.min(50, Number($("#dailySize").value) || 20));
  }
  if ($("#cooldown")) {
    store.state.cooldown_days = Math.max(1, Math.min(90, Number($("#cooldown").value) || 14));
  }

  persist();
  if (rebuild) {
    buildToday(true);
    render({ skipInputs: true });
  } else {
    // light stats only
    $("#followingCount") &&
      ($("#followingCount").textContent = `${(store.state.following || []).length}명`);
    $("#followersCount") &&
      ($("#followersCount").textContent = `${(store.state.followers || []).length}명`);
  }
}

const autoSaveDebounced = debounce(() => autoSaveFromInputs(false), 400);
const autoSaveRebuildDebounced = debounce(() => autoSaveFromInputs(true), 700);

function wireAutoSave() {
  const onType = () => autoSaveDebounced();
  const onFollowing = () => autoSaveRebuildDebounced();

  $("#myHandle")?.addEventListener("input", onType);
  $("#myHandle")?.addEventListener("change", onType);
  $("#followingText")?.addEventListener("input", onFollowing);
  $("#followersText")?.addEventListener("input", onType);
  $("#dailySize")?.addEventListener("change", onType);
  $("#dailySize")?.addEventListener("input", onType);
  $("#cooldown")?.addEventListener("change", onType);
  $("#cooldown")?.addEventListener("input", onType);

  // flush on leave / hide
  window.addEventListener("beforeunload", () => {
    autoSaveFromInputs(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autoSaveFromInputs(false);
  });

  const saveStatus = $("#saveStatus");
  const reloadExternalChange = () => {
    if (externalChangePending) location.reload();
  };
  saveStatus?.addEventListener("click", reloadExternalChange);
  saveStatus?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") reloadExternalChange();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== LS_ACCOUNTS && event.key !== LS_STATE) return;
    if (document.visibilityState === "hidden") {
      location.reload();
      return;
    }
    externalChangePending = true;
    const status = $("#saveStatus");
    if (status) {
      status.title = "다른 탭의 최신 데이터를 불러옵니다";
      status.tabIndex = 0;
      status.setAttribute("role", "button");
    }
    setSaveStatus("다른 탭에서 변경됨 · 여기를 눌러 새로고침", false);
    toast("다른 탭에서 데이터가 바뀌었습니다");
  });
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
    pill("완료", `${stats.complete}/${stats.batch}`, "good"),
    pill("팔로잉제외", stats.following),
  ].join("");
  const pct = stats.batch ? Math.round((stats.complete / stats.batch) * 100) : 0;
  $("#bar").style.width = `${pct}%`;
  $("#dailySize").value = stats.daily_size;
  $("#cooldown").value = stats.cooldown_days;
  $("#followingCount").textContent = `${stats.following}명`;
  $("#followersCount").textContent = `${(store.state.followers || []).length}명`;
}

function cardHtml(item, idx) {
  const done = item.hearted && item.replied;
  const tags = (item.tags || []).map((t) => `<span class="tag">#${t}</span>`).join("");
  const tier = item.tier || "mid";
  const rel = item.related ? `<span class="tag">관련</span>` : "";
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
    <div class="tags">${rel}${tags}</div>
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
  const boostSet = new Set((store.state.related_boost || []).map((h) => h.toLowerCase()));
  currentItems = batch.map((h) => {
    const a = byH[h] || { handle: h, name: h, tags: [], note: "" };
    const m = store.state.meta?.[h] || {};
    return {
      ...a,
      handle: h,
      profile: `https://x.com/${h}`,
      hearted: !!m.hearted,
      replied: !!m.replied,
      related: boostSet.has(h.toLowerCase()),
      last_shown: m.last_shown || "",
    };
  });
  return currentItems;
}

function render(opts = {}) {
  const skipInputs = !!opts.skipInputs;
  $("#dateLabel").textContent = todayStr();
  if (!skipInputs) {
    $("#myHandle").value = store.state.my_handle || "";
    const fText =
      store.state.following_text ||
      (store.state.following || []).map((h) => "@" + h).join("\n");
    const frText =
      store.state.followers_text ||
      (store.state.followers || []).map((h) => "@" + h).join("\n");
    if ($("#followingText") && document.activeElement !== $("#followingText")) {
      $("#followingText").value = fText;
    }
    if ($("#followersText") && document.activeElement !== $("#followersText")) {
      $("#followersText").value = frText;
    }
  }
  const items = currentItems;
  renderStats({
    pool: (store.accountsDoc.accounts || []).length,
    batch: items.length,
    hearted: items.filter((x) => x.hearted).length,
    replied: items.filter((x) => x.replied).length,
    complete: items.filter((x) => x.hearted && x.replied).length,
    following: (store.state.following || []).length,
    daily_size: store.state.daily_size || 20,
    cooldown_days: store.state.cooldown_days || 14,
  });

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
        const item = currentItems.find((x) => x.handle === handle);
        if (item) item[field] = inp.checked;
        render();
        toast(`@${handle} ${field}`);
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
  } catch {
    return { version: 2, pack_name: "empty", accounts: [] };
  }
}

async function probeXBridge() {
  const el = $("#xStatus");
  const row = $("#xApiRow");
  if (!hasLocalApi()) {
    el.className = "x-status no";
    el.textContent =
      "X API: 웹 단독 모드 — 팔로워 자동 수집 불가. 붙여넣기 사용. (로컬 run.bat + xurl 시 API 버튼 활성)";
    row.hidden = true;
    return;
  }
  try {
    const res = await fetch("/api/x/status", { cache: "no-store" });
    if (!res.ok) throw new Error("no bridge");
    xBridge = await res.json();
    if (xBridge.xurl && xBridge.authenticated) {
      el.className = "x-status ok";
      el.textContent = "X API: xurl 연동됨 · 팔로잉/팔로워 가져오기 가능";
      row.hidden = false;
    } else if (xBridge.xurl) {
      el.className = "x-status no";
      el.textContent =
        "X API: xurl 설치됨, 로그인 필요 → 터미널에서 `xurl auth oauth2` 후 새로고침";
      row.hidden = true;
    } else {
      el.className = "x-status no";
      el.textContent =
        "X API: xurl 없음. `npm i -g @xdevplatform/xurl` 후 auth, 또는 붙여넣기 사용";
      row.hidden = true;
    }
  } catch {
    el.className = "x-status no";
    el.textContent = "X API: 로컬 서버 API 없음 — 붙여넣기 모드";
    row.hidden = true;
  }
}

async function apiFetchList(kind) {
  const handle = normHandle($("#myHandle").value || store.state.my_handle);
  if (!handle) return toast("내 핸들 먼저 입력");
  const max = Number($("#fetchMax").value) || 500;
  toast(`${kind} 가져오는 중…`);
  try {
    const res = await fetch(
      `/api/x/${kind}?handle=${encodeURIComponent(handle)}&max=${max}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const handles = (data.handles || []).map(normHandle).filter(Boolean);
    if (kind === "following") {
      store.state.following = [...new Set([...(store.state.following || []), ...handles])].sort();
      store.state.following_text = store.state.following.map((h) => "@" + h).join("\n");
      $("#followingText").value = store.state.following_text;
    } else {
      store.state.followers = [...new Set([...(store.state.followers || []), ...handles])].sort();
      store.state.followers_text = store.state.followers.map((h) => "@" + h).join("\n");
      $("#followersText").value = store.state.followers_text;
    }
    store.state.my_handle = handle;
    persist();
    buildToday(true);
    render();
    toast(`${kind} ${handles.length}명 (누적 반영)`);
  } catch (e) {
    toast("실패: " + (e.message || e));
  }
}

function runRelated() {
  const me = normHandle($("#myHandle").value || store.state.my_handle);
  store.state.my_handle = me;
  const following = store.state.following || [];
  const scored = scoreRelated(store.accountsDoc.accounts || [], following, me);
  const top = scored.slice(0, Number(store.state.daily_size) || 20).map((x) => x.handle);
  store.state.related_boost = top;
  // force new batch prioritizing related
  store.state.last_batch_date = "";
  store.state.last_batch = [];
  persist();
  buildToday(true);
  render();
  const msg = following.length
    ? `관련 추천 ${top.length}명 (팔로잉 ${following.length} 기준 태그 가중)`
    : `관련 추천 ${top.length}명 (팔로잉 없음 → 풀 core/mid 우선). 팔로잉 넣으면 더 정확해짐`;
  toast(msg);
}

function mergeAccounts(list, mode) {
  if (mode === "replace") store.accountsDoc.accounts = [];
  const existing = new Map(
    (store.accountsDoc.accounts || []).map((a) => [normHandle(a.handle).toLowerCase(), a])
  );
  let added = 0;
  for (const a of list || []) {
    if (!a || typeof a !== "object") continue;
    const h = normHandle(a.handle);
    if (!h) continue;
    const key = h.toLowerCase();
    if (mode !== "replace" && existing.has(key)) continue;
    const entry = {
      handle: h,
      name: a.name || h,
      tags: a.tags || ["imported"],
      tier: a.tier || "mid",
      verified: !!a.verified,
      note: a.note || "imported",
    };
    store.accountsDoc.accounts = store.accountsDoc.accounts || [];
    store.accountsDoc.accounts.push(entry);
    existing.set(key, entry);
    added++;
  }
  return added;
}

function parsePack(pack) {
  let accountsList = [];
  let meta = {};
  if (Array.isArray(pack.accounts)) accountsList = pack.accounts;
  else if (pack.accounts && typeof pack.accounts === "object") {
    accountsList = pack.accounts.accounts || [];
    meta = pack.accounts;
  } else if (Array.isArray(pack.items)) accountsList = pack.items;
  return { accountsList, meta, state: pack.state };
}

function applyPackObject(pack, mode, withState) {
  const { accountsList, meta, state } = parsePack(pack);
  if (meta.pack_name) store.accountsDoc.pack_name = meta.pack_name;
  const added = mergeAccounts(accountsList, mode);
  if (withState && state && typeof state === "object") {
    store.state = { ...DEFAULT_STATE(), ...state };
  }
  persist();
  buildToday(true);
  render();
  return added;
}

async function init() {
  const hasLocal = !!localStorage.getItem(LS_ACCOUNTS);
  store.state = { ...DEFAULT_STATE(), ...loadJSON(LS_STATE, DEFAULT_STATE) };
  if (hasLocal) {
    store.accountsDoc = loadJSON(LS_ACCOUNTS, { accounts: [] });
  } else {
    // migrate v1 if present
    const v1 = localStorage.getItem("nod_v1_accounts");
    if (v1) {
      try {
        store.accountsDoc = JSON.parse(v1);
      } catch {
        store.accountsDoc = await loadSeedAccounts();
      }
      const s1 = localStorage.getItem("nod_v1_state");
      if (s1) {
        try {
          store.state = { ...DEFAULT_STATE(), ...JSON.parse(s1) };
        } catch { /* ignore */ }
      }
    } else {
      store.accountsDoc = await loadSeedAccounts();
    }
    persist();
  }

  const params = new URLSearchParams(location.search);
  if (params.get("pack")) {
    try {
      const res = await fetch(params.get("pack"), { cache: "no-store" });
      applyPackObject(await res.json(), "merge", false);
    } catch (e) {
      toast("pack URL 실패");
    }
  }

  await probeXBridge();
  buildToday(false);
  render();
  wireAutoSave();
  if (store.state.saved_at) {
    setSaveStatus("이전 세션 복원됨 · 자동저장 ON", true);
  } else {
    setSaveStatus("브라우저 자동저장 ON", true);
  }
}

// events
$("#btnSaveMe").addEventListener("click", () => {
  autoSaveFromInputs(false);
  toast(store.state.my_handle ? `@${store.state.my_handle} 저장됨` : "핸들 비움");
});

$("#btnOpenMe").addEventListener("click", () => {
  const h = normHandle($("#myHandle").value || store.state.my_handle);
  if (!h) return toast("핸들 입력");
  window.open(`https://x.com/${h}`, "_blank", "noopener");
});

$("#btnRelated").addEventListener("click", runRelated);
$("#btnUseFollowingExclude").addEventListener("click", () => {
  const handles = parseHandles($("#followingText").value);
  if (handles.length) {
    store.state.following = [...new Set([...(store.state.following || []), ...handles])].sort();
  }
  persist();
  buildToday(true);
  render();
  toast(`팔로잉 제외 ${store.state.following.length}명`);
});

$("#btnCopyFollowers").addEventListener("click", async () => {
  const list = store.state.followers || [];
  if (!list.length) return toast("팔로워 없음 — 붙여넣기 또는 API");
  await copyText(list.map((h) => "@" + h).join("\n"));
  toast(`팔로워 ${list.length} 복사`);
});

$("#btnCopyFollowing").addEventListener("click", async () => {
  const list = store.state.following || [];
  if (!list.length) return toast("팔로잉 없음");
  await copyText(list.map((h) => "@" + h).join("\n"));
  toast(`팔로잉 ${list.length} 복사`);
});

$("#btnFetchFollowing").addEventListener("click", () => apiFetchList("following"));
$("#btnFetchFollowers").addEventListener("click", () => apiFetchList("followers"));

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
  downloadJson(`niche-outreach-pack-${todayStr()}.json`, {
    format: "niche-outreach-pack",
    version: 1,
    exported_at: new Date().toISOString(),
    accounts: store.accountsDoc,
  });
  toast("팩 다운로드");
});

$("#btnExportFull").addEventListener("click", () => {
  downloadJson(`niche-outreach-backup-${todayStr()}.json`, {
    format: "niche-outreach-pack",
    version: 1,
    exported_at: new Date().toISOString(),
    accounts: store.accountsDoc,
    state: store.state,
  });
  toast("백업 다운로드");
});

$("#btnImportFollowing").addEventListener("click", () => {
  autoSaveFromInputs(true);
  toast(`팔로잉 ${(store.state.following || []).length} · 자동저장`);
});

$("#btnImportFollowers").addEventListener("click", () => {
  autoSaveFromInputs(false);
  toast(`팔로워 ${(store.state.followers || []).length} · 자동저장`);
});

$("#btnSaveSettings").addEventListener("click", () => {
  autoSaveFromInputs(false);
  toast("설정 자동저장됨");
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
    const n = applyPackObject(pack, mode, $("#importState").checked);
    $("#packText").value = "";
    toast(`가져옴 +${n}`);
  } catch (e) {
    toast(String(e.message || e));
  }
});

$("#btnLoadPackUrl").addEventListener("click", async () => {
  const url = $("#packUrl").value.trim();
  if (!url) return toast("URL 입력");
  try {
    const res = await fetch(url, { cache: "no-store" });
    const pack = await res.json();
    const mode = document.querySelector('input[name="packMode"]:checked')?.value || "merge";
    applyPackObject(pack, mode, $("#importState").checked);
    toast("URL OK");
  } catch (e) {
    toast("실패: " + e.message);
  }
});

$("#btnResetLocal").addEventListener("click", () => {
  if (!confirm("이 브라우저 데이터 초기화?")) return;
  localStorage.removeItem(LS_ACCOUNTS);
  localStorage.removeItem(LS_STATE);
  localStorage.removeItem("nod_v1_accounts");
  localStorage.removeItem("nod_v1_state");
  localStorage.removeItem("nod_v1_config");
  location.reload();
});

init().catch((e) => {
  $("#empty").hidden = false;
  $("#empty").textContent = "초기화 실패: " + e.message;
});
