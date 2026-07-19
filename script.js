// ===== Supabase 연결 =====
const SUPABASE_URL = "https://czkdfopmbfdlxtegwgav.supabase.co";
const SUPABASE_KEY = "sb_publishable_YTFDp9WweP3alI-71yE4rg_UMbpQFMS";
const sb = window.supabase ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ===== 상태 =====
// item: { id(uuid), name, price, qty, done, cat, priority, created_at, purchased_at, updated_at, pending }
let items = [];
let view = "cart"; // "cart" | "history"
// 필터는 다중 선택(배열). 비어 있으면 전체.
let filterCats = [];
let filterPris = [];
// 선택된 항목 id 모음(화면 전용). 체크는 고르기만, 처리는 하단 버튼이 함.
let selected = new Set();
// 열려 있는 바텀시트: null | "add" | "filter" | "edit" | "catalog"
let sheet = null;
const FIRST_CAT = Object.keys(CATEGORIES)[0];
let add = { cat: FIRST_CAT, name: "", price: "", qty: 1, pri: 3 };
let edit = null;
// 추천 품목(카탈로그): DB(catalog_items)에서 불러옴. row: {id, cat, name, price}
let catalog = [];
// 추천 품목 관리 시트를 닫을 때 돌아갈 추가 시트의 분류
let catalogReturnCat = null;

// ===== 요소 참조 =====
const appHeader = document.getElementById("app-header");
const quickChips = document.getElementById("quick-chips");
const screen = document.getElementById("screen");
const fab = document.getElementById("fab");
const actionBar = document.getElementById("action-bar");
const tabbar = document.getElementById("tabbar");
const sheetHost = document.getElementById("sheet-host");
const sheetBackdrop = document.getElementById("sheet-backdrop");
const errorBanner = document.getElementById("error-banner");
const offlineBanner = document.getElementById("offline-banner");

// ===== 작은 도우미 =====
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function money(n) { return (Number(n) || 0).toLocaleString() + "원"; }
function dateLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}
function currentPool() { return items.filter((x) => (view === "cart" ? !x.done : x.done)); }
function visibleItems() {
  return currentPool().filter(
    (x) =>
      (filterCats.length === 0 || filterCats.includes(x.cat)) &&
      (filterPris.length === 0 || filterPris.includes(x.priority))
  );
}

// SVG 아이콘 (탭/필터)
const SVG_CART = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 11H7z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>';
const SVG_HIST = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4l3 2"/></svg>';
const SVG_FILTER = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16l-6 7v5l-4-2v-3z"/></svg>';
const SVG_FILTER_SM = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16l-6 7v5l-4-2v-3z"/></svg>';

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
  setTimeout(() => (errorBanner.hidden = true), 4000);
}
function showNotice(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add("notice");
  errorBanner.hidden = false;
  setTimeout(() => {
    errorBanner.hidden = true;
    errorBanner.classList.remove("notice");
  }, 4000);
}

// ===== 오프라인 캐시 =====
const CACHE_KEY = "cart-cache";
function isOffline() { return !navigator.onLine || !sb; }
function updateOfflineBanner() { offlineBanner.hidden = !isOffline(); }
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
}
function loadCache() {
  try { items = JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { items = []; }
}

// ===== 추천 품목(카탈로그) =====
// 편집은 온라인 전용(오프라인에선 캐시로 보기만). 목록은 localStorage에 캐시.
const CATALOG_KEY = "cart-catalog";
function saveCatalogCache() {
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch {}
}
// data.js의 CATEGORIES를 카탈로그 형태로 변환 (오프라인 첫 실행 등 폴백용)
function catalogFromDefaults() {
  const out = [];
  Object.keys(CATEGORIES).forEach((c) => {
    const subs = CATEGORIES[c] || {};
    Object.keys(subs).forEach((n) => out.push({ id: "def-" + c + "-" + n, cat: c, name: n, price: subs[n] }));
  });
  return out;
}
function loadCatalogCache() {
  try { catalog = JSON.parse(localStorage.getItem(CATALOG_KEY)) || []; } catch { catalog = []; }
  if (catalog.length === 0) catalog = catalogFromDefaults();
}
function catalogFor(cat) { return catalog.filter((r) => r.cat === cat); }
async function fetchCatalog() {
  if (isOffline()) return;
  const { data, error } = await sb.from("catalog_items").select("*").order("created_at");
  if (error) return; // 실패해도 캐시 유지
  catalog = data;
  saveCatalogCache();
}
async function addCatalogItem(cat, name, price) {
  if (isOffline()) { showError("추천 품목 편집은 인터넷 연결 후 가능해요"); return false; }
  const { data, error } = await sb.from("catalog_items").insert({ cat, name, price }).select().single();
  if (error) { showError(error.code === "23505" ? "이미 있는 추천 품목이에요" : "추가에 실패했어요"); return false; }
  catalog.push(data);
  saveCatalogCache();
  return true;
}
async function updateCatalogItem(id, patch) {
  if (isOffline()) { showError("추천 품목 편집은 인터넷 연결 후 가능해요"); return false; }
  const { data, error } = await sb
    .from("catalog_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) { showError(error.code === "23505" ? "같은 이름의 추천 품목이 이미 있어요" : "수정에 실패했어요"); return false; }
  const i = catalog.findIndex((r) => r.id === id);
  if (i !== -1) catalog[i] = data;
  saveCatalogCache();
  return true;
}
async function deleteCatalogItem(id) {
  if (isOffline()) { showError("추천 품목 편집은 인터넷 연결 후 가능해요"); return false; }
  const { error } = await sb.from("catalog_items").delete().eq("id", id);
  if (error) { showError("삭제에 실패했어요"); return false; }
  catalog = catalog.filter((r) => r.id !== id);
  saveCatalogCache();
  return true;
}

// ===== 오프라인 변경 큐 =====
const QUEUE_KEY = "cart-queue";
let queue = [];
function loadQueue() {
  try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { queue = []; }
}
function saveQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {}
}
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function queueUpdate(id, patch) {
  const ts = new Date().toISOString();
  const addOp = queue.find((op) => op.kind === "add" && op.row.id === id);
  if (addOp) {
    Object.assign(addOp.row, patch, { updated_at: ts });
  } else {
    const upOp = queue.find((op) => op.kind === "update" && op.id === id);
    if (upOp) { Object.assign(upOp.patch, patch); upOp.ts = ts; }
    else queue.push({ kind: "update", id, patch: { ...patch }, ts });
  }
  saveQueue();
  const i = items.findIndex((x) => x.id === id);
  if (i !== -1) items[i] = { ...items[i], ...patch, updated_at: ts, pending: true };
}
function queueDelete(id) {
  const wasLocalAdd = queue.some((op) => op.kind === "add" && op.row.id === id);
  queue = queue.filter(
    (op) => !(op.kind === "add" && op.row.id === id) && !(op.kind === "update" && op.id === id)
  );
  if (!wasLocalAdd) queue.push({ kind: "delete", id, ts: new Date().toISOString() });
  saveQueue();
  items = items.filter((x) => x.id !== id);
}
function applyQueue(rows) {
  let out = rows.slice();
  queue.forEach((op) => {
    if (op.kind === "add" && !out.some((x) => x.id === op.row.id)) {
      out.push({ ...op.row, pending: true });
    } else if (op.kind === "update") {
      const i = out.findIndex((x) => x.id === op.id);
      if (i !== -1) out[i] = { ...out[i], ...op.patch, pending: true };
    } else if (op.kind === "delete") {
      out = out.filter((x) => x.id !== op.id);
    }
  });
  return out;
}
let flushing = false;
async function flushQueue() {
  if (flushing || isOffline() || queue.length === 0) return;
  flushing = true;
  let sent = 0, conflicts = 0;
  try {
    while (queue.length > 0 && !isOffline()) {
      const op = queue[0];
      if (op.kind === "add") {
        const { error } = await sb.from("cart_items").insert(op.row);
        if (error && error.code !== "23505") {
          if (!error.code) break;
          showError("저장하지 못한 항목이 있어요: " + op.row.name);
        }
      } else if (op.kind === "update") {
        const { data, error } = await sb
          .from("cart_items")
          .update({ ...op.patch, updated_at: op.ts })
          .eq("id", op.id)
          .lte("updated_at", op.ts)
          .select();
        if (error) { if (!error.code) break; showError("수정을 반영하지 못한 항목이 있어요"); }
        else if (data.length === 0) conflicts++;
      } else if (op.kind === "delete") {
        const { data, error } = await sb
          .from("cart_items")
          .delete()
          .eq("id", op.id)
          .lte("updated_at", op.ts)
          .select();
        if (error) { if (!error.code) break; }
        else if (data.length === 0) {
          const { data: still } = await sb.from("cart_items").select("id").eq("id", op.id);
          if (still && still.length > 0) conflicts++;
        }
      }
      queue.shift();
      saveQueue();
      sent++;
    }
  } catch {}
  flushing = false;
  if (sent > 0) {
    await fetchItems();
    if (conflicts > 0) showNotice(`다른 기기에서 더 최근에 바뀐 ${conflicts}건은 서버 내용을 따랐어요`);
    else showNotice(`오프라인 변경 ${sent}건을 서버에 반영했어요`);
  }
}

// ===== 품목명 요약 (규칙 기반) =====
const NOISE_WORDS = [
  "무료배송", "국내배송", "당일발송", "당일출고", "빠른배송", "초특가",
  "사은품증정", "공식판매점", "본사직영", "정품", "특가", "최저가",
  "할인", "세일", "이벤트", "증정", "사은품", "베스트", "인기",
  "신상품", "공식", "본사",
];
function isUnitWord(w) {
  return /\d+\s*(ml|l|g|kg|개입|개|매|롤|팩|입|구|병|캔|박스|포|모|단|송이|마리)/i.test(w) || /^x\s*\d+$/i.test(w);
}
function summarizeName(title) {
  let t = title;
  t = t.replace(/\[[^\]]*\]/g, " ");
  t = t.replace(/\(([^)]*)\)/g, (m, inner) => (isUnitWord(inner) ? m : " "));
  NOISE_WORDS.forEach((w) => { t = t.split(w).join(" "); });
  t = t.replace(/[★☆♥●■◆◈™®]/g, " ").replace(/\s{2,}/g, " ").trim();
  const seen = new Set();
  let words = t.split(" ").filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (words.join(" ").length > 25) words = words.filter((w, i) => i < 3 || isUnitWord(w));
  const out = words.join(" ").trim();
  return out || title;
}

// ===== DB 함수 =====
async function fetchItems() {
  const { data, error } = await sb.from("cart_items").select("*").order("created_at");
  if (error) return showError("목록을 불러오지 못했어요");
  items = applyQueue(data);
  render();
  maybeNoticeStale(); // 데이터 로드 후 오래된 기록 감지(1회 안내)
}
async function loadItems() {
  if (isOffline()) return updateOfflineBanner();
  if (queue.length > 0) return flushQueue();
  await fetchItems();
  fetchCatalog(); // 추천 품목도 최신화 (실패해도 조용히)
}
async function addItem(fields) {
  if (isOffline()) {
    const now = new Date().toISOString();
    const row = { id: newId(), ...fields, created_at: now, updated_at: now };
    queue.push({ kind: "add", row });
    saveQueue();
    items.push({ ...row, pending: true });
    return render();
  }
  const { data, error } = await sb.from("cart_items").insert(fields).select().single();
  if (error) return showError("저장에 실패했어요");
  items.push(data);
  render();
}
async function updateItem(id, patch) {
  if (isOffline()) { queueUpdate(id, patch); return render(); }
  const { data, error } = await sb
    .from("cart_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return showError("수정에 실패했어요");
  const i = items.findIndex((x) => x.id === id);
  if (i !== -1) items[i] = data;
  render();
}
async function deleteItem(id) {
  if (isOffline()) { queueDelete(id); return render(); }
  const { error } = await sb.from("cart_items").delete().eq("id", id);
  if (error) return showError("삭제에 실패했어요");
  items = items.filter((x) => x.id !== id);
  render();
}
async function deleteSelected() {
  const ids = [...selected];
  if (ids.length === 0) return;
  if (isOffline()) return showError("여러 개 삭제는 인터넷 연결 후 가능해요");
  const { error } = await sb.from("cart_items").delete().in("id", ids);
  if (error) return showError("삭제에 실패했어요");
  selected.clear();
  items = items.filter((x) => !ids.includes(x.id));
  render();
}
async function bulkUpdate(ids, patch) {
  if (ids.length === 0) return;
  if (isOffline()) { ids.forEach((id) => queueUpdate(id, patch)); return render(); }
  const { data, error } = await sb
    .from("cart_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .in("id", ids)
    .select();
  if (error) return showError("일괄 처리에 실패했어요");
  data.forEach((row) => {
    const i = items.findIndex((x) => x.id === row.id);
    if (i !== -1) items[i] = row;
  });
  render();
}
function donePatch(checked) {
  return { done: checked, purchased_at: checked ? new Date().toISOString() : null };
}

// ===== 구매완료(기록) 30일 정리 =====
// 하이브리드: 앱 열 때 오래된 기록을 "감지만" 하고, 사용자가 "정리"를 눌러
// 확인해야 실제 삭제(DB 영구삭제·전 기기 반영). 온라인 전용.
const STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// 구매완료(done)이고 purchased_at이 30일보다 오래됐나
function isStale(it) {
  if (!it.done || !it.purchased_at) return false;
  const t = new Date(it.purchased_at).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t > STALE_DAYS * DAY_MS;
}
function staleHistory() { return items.filter(isStale); }
// 30일 지난 기록을 DB에서 한 번에(.in) 영구삭제
async function deleteStaleHistory() {
  const ids = staleHistory().map((x) => x.id);
  if (ids.length === 0) return;
  if (isOffline()) return showError("오래된 기록 정리는 인터넷 연결 후 가능해요");
  const { error } = await sb.from("cart_items").delete().in("id", ids);
  if (error) return showError("정리에 실패했어요");
  items = items.filter((x) => !ids.includes(x.id));
  render();
  showNotice(`오래된 기록 ${ids.length}건을 정리했어요`);
}
// 앱을 연 세션에서 한 번만: 오래된 기록이 있으면 안내(삭제는 사용자 확인)
let staleNoticed = false;
function maybeNoticeStale() {
  if (staleNoticed) return;
  const n = staleHistory().length;
  if (n === 0) return;
  staleNoticed = true;
  showNotice(`30일 지난 구매 기록 ${n}건이 있어요. 기록 탭에서 정리할 수 있어요`);
}
async function migrateLocal() {
  let old;
  try { old = JSON.parse(localStorage.getItem("cart-items")) || []; } catch { old = []; }
  if (old.length === 0) return;
  const rows = old.map((o) => ({
    name: o.name, price: Number(o.price) || 0, qty: Number(o.qty) || 1,
    done: !!o.done, cat: o.cat || "기타", priority: 3,
  }));
  const { error } = await sb.from("cart_items").insert(rows);
  if (!error) localStorage.removeItem("cart-items");
}

// ===== 네이버 실시간 추천 =====
async function searchNaver(q) {
  const res = await fetch("/api/search?q=" + encodeURIComponent(q));
  if (!res.ok) throw new Error("api");
  const data = await res.json();
  return data.items || [];
}
// ===== 추천 품목(catalog) 로컬 자동완성 =====
// 정규화: 소문자 + 공백 제거 (띄어쓰기 차이를 무시하고 매칭)
function normKo(s) { return (s || "").toLowerCase().replace(/\s+/g, ""); }
// 입력어 q와 유사한 추천 품목을 전체 분류에서 찾음. startsWith > includes 우선.
function matchCatalog(q) {
  const nq = normKo(q);
  if (!nq) return [];
  const scored = [];
  catalog.forEach((r) => {
    const nn = normKo(r.name);
    let score;
    if (nn === nq) score = 0;               // 완전 일치
    else if (nn.startsWith(nq)) score = 1;  // 앞부분 일치("우유"→"우유 (1L)")
    else if (nn.includes(nq)) score = 2;    // 중간 포함
    else if (nn.length >= 2 && nq.includes(nn)) score = 3; // 입력이 품목명을 포함
    else return;
    scored.push({ r, score });
  });
  scored.sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length);
  return scored.slice(0, 6).map((x) => x.r);
}
// catalog 매칭 결과를 container에 그림. 이름·분류태그·가격. 클릭 시 onPick(r)
function renderCatalogSugsInto(container, rows, onPick) {
  container.innerHTML = "";
  if (!rows || !rows.length) { container.hidden = true; return; }
  container.hidden = false;
  container.append(el("div", "sugs-label", "추천 품목 · 눌러서 반영"));
  rows.forEach((r) => {
    const row = el("div", "sug-item");
    const left = el("div", "sug-name-wrap");
    left.append(el("span", "sug-name", r.name), el("span", "sug-cat", r.cat));
    row.append(left, el("span", "sug-price", money(r.price)));
    row.addEventListener("click", () => onPick(r));
    container.append(row);
  });
}

// 추천 목록을 container에 그림. 클릭하면 onPick(s)
function renderSugsInto(container, sugs, onPick) {
  container.innerHTML = "";
  if (!sugs || !sugs.length) { container.hidden = true; return; }
  container.hidden = false;
  container.append(el("div", "sugs-label", "네이버 쇼핑 최저가 · 눌러서 반영"));
  sugs.slice(0, 5).forEach((s) => {
    const row = el("div", "sug-item");
    row.append(el("span", "sug-name", s.title), el("span", "sug-price", (Number(s.lprice) || 0).toLocaleString() + "원"));
    row.addEventListener("click", () => onPick(s));
    container.append(row);
  });
}

// ===== 선택 처리 =====
function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}
function completeSelected() {
  const ids = [...selected];
  selected.clear();
  bulkUpdate(ids, donePatch(view === "cart"));
}
function clearSelectedItems() {
  const ids = [...selected];
  if (ids.length === 0) return;
  askConfirm(`선택한 ${ids.length}개 품목을 삭제할까요?`).then((ok) => { if (ok) deleteSelected(); });
}

// ===== 화면 그리기 =====
function render() {
  saveCache();
  const isCart = view === "cart";
  const vis = visibleItems();
  const total = vis.reduce((t, i) => t + i.price * i.qty, 0);
  const pool = currentPool();

  // 안 보이는 항목은 선택에서 제외 (가려진 항목이 몰래 처리되는 것 방지)
  const visIds = new Set(vis.map((x) => x.id));
  [...selected].forEach((id) => { if (!visIds.has(id)) selected.delete(id); });

  renderHeader(isCart, pool, total);
  renderChips(isCart, pool);
  renderScreen(isCart, vis);
  renderBottom(isCart);
  updateOfflineBanner();
}

function renderHeader(isCart, pool, total) {
  appHeader.innerHTML = "";
  const top = el("div", "h-top");
  const left = el("div");
  left.append(el("div", "h-title", isCart ? "장바구니" : "구매 기록"));
  const sub = el("div", "h-sub");
  const histAll = items.filter((x) => x.done);
  const countTxt = isCart ? pool.length + "개 품목" : histAll.length + "개 구매";
  sub.append(document.createTextNode(countTxt + " · "));
  const b = el("b", null, money(total));
  sub.append(b);
  left.append(sub);
  top.append(left);

  if (isCart) {
    const pill = el("button", "filter-pill");
    pill.type = "button";
    pill.innerHTML = SVG_FILTER_SM + "<span>필터</span>";
    const nf = filterCats.length + filterPris.length;
    if (nf > 0) pill.append(el("span", "filter-pill-badge", String(nf)));
    pill.addEventListener("click", openFilterSheet);
    top.append(pill);
  }
  appHeader.append(top);

  if (!isCart) {
    const histTotal = histAll.reduce((t, i) => t + i.price * i.qty, 0);
    const card = el("div", "hist-card");
    card.append(el("div", "hist-card-label", "누적 지출"), el("div", "hist-card-total", money(histTotal)));
    appHeader.append(card);

    // 30일 지난 기록이 있으면 정리 바(건수 + 정리 버튼). 누르면 확인 후 삭제.
    const stale = staleHistory();
    if (stale.length) {
      const bar = el("div", "hist-cleanup");
      bar.append(el("span", "hist-cleanup-txt", `30일 지난 기록 ${stale.length}건`));
      const btn = el("button", "hist-cleanup-btn", "정리");
      btn.type = "button";
      btn.addEventListener("click", () => {
        askConfirm(`30일 지난 구매 기록 ${stale.length}건을 삭제할까요? 삭제하면 되돌릴 수 없어요.`)
          .then((ok) => { if (ok) deleteStaleHistory(); });
      });
      bar.append(btn);
      appHeader.append(bar);
    }
  }
}

function makeChip(label, active, onClick, extra) {
  const b = el("button", "chip" + (extra ? " " + extra : ""), label);
  b.type = "button";
  if (active) b.classList.add("is-active");
  b.addEventListener("click", onClick);
  return b;
}

function renderChips(isCart, pool) {
  if (!isCart) { quickChips.hidden = true; return; }
  quickChips.hidden = false;
  quickChips.innerHTML = "";
  const noFilter = filterCats.length === 0 && filterPris.length === 0;
  const urgentActive =
    filterPris.length === 2 && filterPris.includes(1) && filterPris.includes(2) && filterCats.length === 0;
  const urgentCount = pool.filter((x) => x.priority <= 2).length;

  quickChips.append(
    makeChip("전체 " + pool.length, noFilter, () => { filterCats = []; filterPris = []; render(); })
  );
  quickChips.append(
    makeChip("급한 것만 " + urgentCount, urgentActive, () => {
      if (urgentActive) { filterCats = []; filterPris = []; }
      else { filterCats = []; filterPris = [1, 2]; }
      render();
    }, "chip-urgent")
  );
  Object.keys(CATEGORIES).forEach((c) => {
    if (!pool.some((x) => x.cat === c)) return;
    const active = filterCats.length === 1 && filterCats[0] === c;
    quickChips.append(
      makeChip(c + " " + pool.filter((x) => x.cat === c).length, active, () => {
        filterCats = filterCats.length === 1 && filterCats[0] === c ? [] : [c];
        render();
      })
    );
  });
}

function renderScreen(isCart, vis) {
  screen.innerHTML = "";
  if (vis.length === 0) {
    const msg = isCart
      ? (currentPool().length ? "이 필터에 해당하는 품목이 없어요" : "장바구니가 비어 있어요.\n+ 버튼으로 담아 보세요")
      : "아직 구매 기록이 없어요";
    const e = el("div", "empty", msg);
    e.style.whiteSpace = "pre-line";
    screen.append(e);
    return;
  }

  let groups;
  if (isCart) {
    groups = Object.keys(CATEGORIES)
      .map((c) => ({ label: c, rows: vis.filter((i) => i.cat === c) }))
      .filter((g) => g.rows.length);
  } else {
    const byDate = {};
    vis.forEach((i) => {
      const k = i.purchased_at ? dateLabel(i.purchased_at) : "날짜 없음";
      (byDate[k] = byDate[k] || []).push(i);
    });
    const keys = Object.keys(byDate).sort().reverse();
    keys.sort((a, b) => (a === "날짜 없음" ? 1 : 0) - (b === "날짜 없음" ? 1 : 0));
    groups = keys.map((k) => ({ label: "🧾 " + k, rows: byDate[k] }));
  }

  groups.forEach((g) => {
    const head = el("div", "group-head");
    const subtotal = g.rows.reduce((t, i) => t + i.price * i.qty, 0);
    head.append(el("span", "group-label", g.label), el("span", "group-sub", "소계 " + money(subtotal)));
    screen.append(head);
    const card = el("div", "card");
    [...g.rows].sort((x, y) => x.priority - y.priority).forEach((it) => card.append(buildRow(it)));
    screen.append(card);
  });
}

function buildRow(it) {
  const row = el("div", "row");
  const p = priorityInfo(it.priority);
  const sel = selected.has(it.id);

  const chk = el("span", "row-check");
  if (sel) { chk.classList.add("is-sel"); chk.textContent = "✓"; }
  else if (it.done) { chk.classList.add("is-done"); chk.textContent = "✓"; }
  chk.addEventListener("click", (e) => { e.stopPropagation(); toggleSelect(it.id); });

  const main = el("div", "row-main");
  const name = el("div", "row-name" + (it.done ? " is-done" : ""));
  name.append(document.createTextNode(it.name + " "));
  name.append(el("span", "qty", "×" + it.qty));
  const meta = el("div", "row-meta");
  const dot = el("span", "pri-dot");
  dot.style.background = p.color;
  meta.append(dot, document.createTextNode(p.label));
  main.append(name, meta);

  const right = el("div", "row-right");
  if (it.pending) {
    const pd = el("span", "row-pending", "⏳");
    pd.title = "연결되면 자동 저장돼요";
    right.append(pd);
  }
  right.append(el("div", "row-price" + (it.done ? " is-done" : ""), money(it.price * it.qty)));

  row.append(chk, main, right);
  row.addEventListener("click", () => openEditSheet(it.id));
  return row;
}

function makeTab(svg, label, active, onClick) {
  const b = el("button", "tab" + (active ? " is-active" : ""));
  b.type = "button";
  b.innerHTML = svg;
  b.append(el("span", "tab-label", label));
  b.addEventListener("click", onClick);
  return b;
}

function renderBottom(isCart) {
  const hasSel = selected.size > 0;
  fab.hidden = !(isCart && !hasSel);

  if (hasSel) {
    actionBar.innerHTML = "";
    const clear = el("button", "ab-clear", "비우기");
    clear.type = "button";
    clear.addEventListener("click", clearSelectedItems);
    const complete = el("button", "ab-complete",
      (isCart ? "구매 완료" : "장바구니로 되돌리기") + " (" + selected.size + ")");
    complete.type = "button";
    complete.addEventListener("click", completeSelected);
    actionBar.append(clear, complete);
    actionBar.hidden = false;
  } else {
    actionBar.hidden = true;
  }

  tabbar.hidden = hasSel;
  if (!hasSel) {
    tabbar.innerHTML = "";
    tabbar.append(
      makeTab(SVG_CART, "장바구니", isCart, () => { view = "cart"; selected.clear(); render(); }),
      makeTab(SVG_HIST, "기록", !isCart, () => { view = "history"; selected.clear(); render(); }),
      makeTab(SVG_FILTER, "필터", false, openFilterSheet)
    );
  }
}

// ===== 바텀시트 공통 =====
function showBackdrop() { sheetBackdrop.hidden = false; }
function closeSheet() {
  // 추천 품목 관리 시트를 닫으면 원래 추가 시트로 복귀
  const back = sheet === "catalog" ? catalogReturnCat : null;
  catalogReturnCat = null;
  sheet = null;
  sheetHost.innerHTML = "";
  sheetBackdrop.hidden = true;
  if (back) openAddSheet(back);
}
function sheetShell(title, rightNode) {
  const s = el("div", "sheet");
  s.append(el("div", "sheet-handle"));
  const head = el("div", "sheet-head");
  head.append(el("span", "sheet-title", title));
  if (rightNode) head.append(rightNode);
  s.append(head);
  return s;
}
// 중요도 세그먼트(공용): pick(value) 콜백, getVal()로 현재값
function buildPriSegments(getVal, pick) {
  const row = el("div", "seg-row");
  const segs = [];
  PRIORITIES.forEach((p) => {
    const seg = el("div", "seg");
    seg.style.background = p.color;
    seg.append(el("span", "seg-mark", "✓"));
    seg.addEventListener("click", () => { pick(p.value); refreshSeg(); });
    row.append(seg);
    segs.push({ seg, p });
  });
  function refreshSeg() {
    segs.forEach(({ seg, p }) => {
      const on = getVal() === p.value;
      seg.classList.toggle("is-on", on);
      seg.style.boxShadow = on ? `0 0 0 3px #fff, 0 0 0 6px ${p.color}` : "none";
    });
  }
  refreshSeg();
  return { row, refreshSeg };
}
function stepper(getVal, setVal) {
  const wrap = el("div", "stepper");
  const minus = el("button", "stepper-btn", "−");
  minus.type = "button";
  const val = el("span", "stepper-val", String(getVal()));
  const plus = el("button", "stepper-btn", "+");
  plus.type = "button";
  minus.addEventListener("click", () => { setVal(Math.max(1, getVal() - 1)); val.textContent = String(getVal()); });
  plus.addEventListener("click", () => { setVal(getVal() + 1); val.textContent = String(getVal()); });
  wrap.append(minus, val, plus);
  return wrap;
}

// ===== 추가 시트 =====
let addSugTimer;
function openAddSheet(presetCat) {
  sheet = "add";
  add = { cat: presetCat || FIRST_CAT, name: "", price: "", qty: 1, pri: 3 };
  buildAddSheet();
  showBackdrop();
}
function buildAddSheet() {
  sheetHost.innerHTML = "";
  const close = el("button", "sheet-close", "×");
  close.type = "button";
  close.addEventListener("click", closeSheet);
  const s = sheetShell("품목 추가", close);
  const body = el("div", "sheet-body sh");

  // 분류 칩
  body.append(el("div", "field-label", "분류"));
  const catScroll = el("div", "chip-scroll sh");
  const catBtns = [];
  Object.keys(CATEGORIES).forEach((c) => {
    const b = el("button", "chip-pick", c);
    b.type = "button";
    if (add.cat === c) b.classList.add("is-on");
    b.addEventListener("click", () => setCat(c, true)); // 분류 직접 바꾸면 품목명 초기화
    catBtns.push({ b, c });
    catScroll.append(b);
  });
  body.append(catScroll);

  // 추천 품목 select (+ 편집 버튼)
  const subHead = el("div", "field-row");
  subHead.append(el("span", "field-label", "추천 품목"));
  const manageLink = el("button", "sheet-link cat-manage", "＋ 편집");
  manageLink.type = "button";
  manageLink.style.color = "var(--indigo)";
  manageLink.addEventListener("click", () => openCatalogSheet(add.cat));
  subHead.append(manageLink);
  body.append(subHead);
  const subSelect = el("select", "fld");
  subSelect.style.marginBottom = "14px";
  fillAddSub(subSelect);
  subSelect.addEventListener("change", () => {
    const id = subSelect.value;
    if (!id) return;
    const r = catalog.find((x) => x.id === id);
    if (!r) return;
    add.name = r.name; add.price = String(r.price);
    nameInput.value = r.name; priceInput.value = add.price;
    addSugs.hidden = true; addSugs.innerHTML = "";
    updateAddBtn();
  });
  body.append(subSelect);

  // 품목명 + 네이버 추천
  body.append(el("div", "field-label", "품목명"));
  const nameInput = el("input", "fld");
  nameInput.placeholder = "예: 삼겹살";
  nameInput.autocomplete = "off";
  nameInput.style.marginBottom = "10px";
  body.append(nameInput);
  const addSugs = el("div", "sugs");
  addSugs.hidden = true;
  body.append(addSugs);
  function hideSugs() { addSugs.hidden = true; addSugs.innerHTML = ""; }
  // 분류 전환(칩 하이라이트 + 서브셀렉트 갱신). clearName이면 품목명/가격도 비움.
  function setCat(c, clearName) {
    add.cat = c;
    catBtns.forEach((x) => x.b.classList.toggle("is-on", x.c === c));
    if (clearName) { add.name = ""; add.price = ""; nameInput.value = ""; priceInput.value = ""; hideSugs(); }
    fillAddSub(subSelect);
    updateAddBtn();
  }
  // 추천 품목(catalog) 선택 → 분류 전환 + 이름/가격/서브셀렉트 반영
  function pickCatalog(r) {
    setCat(r.cat, false);
    add.name = r.name; add.price = String(r.price);
    nameInput.value = r.name; priceInput.value = add.price;
    subSelect.value = r.id;
    hideSugs();
    updateAddBtn();
  }
  nameInput.addEventListener("input", () => {
    add.name = nameInput.value;
    updateAddBtn();
    clearTimeout(addSugTimer);
    const q = nameInput.value.trim();
    if (!q) { hideSugs(); return; }
    // 1) 추천 품목(로컬)에서 유사 항목 먼저 찾음 — 있으면 그것만 보여줌
    const hits = matchCatalog(q);
    if (hits.length) { renderCatalogSugsInto(addSugs, hits, pickCatalog); return; }
    // 2) 추천에 없을 때만 네이버 쇼핑 보조 (2자↑, 디바운스)
    if (q.length < 2) { hideSugs(); return; }
    addSugTimer = setTimeout(async () => {
      try {
        const sugs = await searchNaver(q);
        if (nameInput.value.trim() !== q) return;
        // 응답 대기 중 입력이 바뀌어 추천 품목에 걸리면 그쪽을 우선
        if (matchCatalog(nameInput.value.trim()).length) return;
        renderSugsInto(addSugs, sugs, (sug) => {
          add.name = summarizeName(sug.title);
          add.price = String(sug.lprice);
          nameInput.value = add.name;
          priceInput.value = add.price;
          hideSugs();
          updateAddBtn();
        });
      } catch { hideSugs(); }
    }, 300);
  });

  // 가격 + 수량
  const two = el("div", "two-col");
  const colPrice = el("div", "col-price");
  colPrice.append(el("div", "field-label", "가격"));
  const priceInput = el("input", "fld fld--price");
  priceInput.setAttribute("inputmode", "numeric");
  priceInput.placeholder = "0";
  priceInput.addEventListener("input", () => {
    priceInput.value = priceInput.value.replace(/[^0-9]/g, "");
    add.price = priceInput.value;
  });
  colPrice.append(priceInput);
  const colQty = el("div", "col-qty");
  colQty.append(el("div", "field-label", "수량"));
  colQty.append(stepper(() => add.qty, (v) => (add.qty = v)));
  two.append(colPrice, colQty);
  body.append(two);

  // 중요도
  const priHead = el("div", "field-row");
  priHead.append(el("span", "field-label", "중요도"));
  const cur = el("span", "field-cur");
  const curDot = el("span", "pri-dot");
  const curLabel = el("span");
  cur.append(curDot, curLabel);
  priHead.append(cur);
  body.append(priHead);
  const seg = buildPriSegments(() => add.pri, (v) => {
    add.pri = v;
    curDot.style.background = priorityInfo(v).color;
    curLabel.textContent = priorityInfo(v).label;
  });
  curDot.style.background = priorityInfo(add.pri).color;
  curLabel.textContent = priorityInfo(add.pri).label;
  body.append(seg.row);

  s.append(body);

  // 추가 버튼
  const addBtn = el("button", "sheet-primary", "장바구니에 추가");
  addBtn.type = "button";
  function updateAddBtn() { addBtn.disabled = add.name.trim().length === 0; }
  updateAddBtn();
  addBtn.addEventListener("click", () => {
    if (add.name.trim().length === 0) return;
    addItem({
      name: add.name.trim(), price: Number(add.price) || 0, qty: add.qty,
      done: false, cat: add.cat, priority: add.pri,
    });
    closeSheet();
  });
  s.append(addBtn);
  sheetHost.append(s);
}
function fillAddSub(subSelect) {
  subSelect.innerHTML = "";
  const manual = document.createElement("option");
  manual.value = ""; manual.textContent = "직접 입력";
  subSelect.append(manual);
  catalogFor(add.cat).forEach((r) => {
    const o = document.createElement("option");
    o.value = r.id; o.textContent = r.name + " — 약 " + money(r.price);
    subSelect.append(o);
  });
}

// ===== 추천 품목 관리 시트 =====
function openCatalogSheet(cat) {
  catalogReturnCat = cat; // 닫으면 이 분류의 추가 시트로 복귀
  sheet = "catalog";
  buildCatalogSheet(cat);
  showBackdrop();
}
function buildCatalogSheet(cat) {
  sheetHost.innerHTML = "";
  const close = el("button", "sheet-close", "×");
  close.type = "button";
  close.addEventListener("click", () => saveAllAndClose());
  const s = sheetShell("추천 품목 · " + cat, close);
  const body = el("div", "sheet-body sh");

  if (isOffline()) {
    const warn = el("div", "cat-offline", "오프라인 상태예요. 추천 품목 편집은 인터넷 연결 후 가능해요.");
    body.append(warn);
  }

  // 새 추천 품목 추가
  body.append(el("div", "field-label", "새 추천 품목 추가"));
  const addRow = el("div", "cat-add");
  const nameI = el("input", "fld cat-name");
  nameI.placeholder = "품목명 (예: 우유 (1L))";
  nameI.autocomplete = "off";
  const priceI = el("input", "fld fld--price cat-price");
  priceI.setAttribute("inputmode", "numeric");
  priceI.placeholder = "가격";
  priceI.addEventListener("input", () => { priceI.value = priceI.value.replace(/[^0-9]/g, ""); });
  const addBtn = el("button", "cat-add-btn", "추가");
  addBtn.type = "button";
  addBtn.addEventListener("click", async () => {
    const nm = nameI.value.trim();
    if (!nm) return;
    const ok = await addCatalogItem(cat, nm, Number(priceI.value) || 0);
    if (ok) { nameI.value = ""; priceI.value = ""; renderList(); showNotice("추천 품목을 추가했어요"); }
  });
  addRow.append(nameI, priceI, addBtn);
  body.append(addRow);

  // 현재 목록
  body.append(el("div", "field-label cat-list-label", "현재 추천 품목"));
  const hint = el("div", "cat-hint", "이름·가격을 고친 뒤 아래 완료를 누르면 한 번에 저장돼요");
  body.append(hint);
  const list = el("div", "cat-list");
  body.append(list);
  s.append(body);

  const done = el("button", "sheet-primary", "완료");
  done.type = "button";
  done.addEventListener("click", () => saveAllAndClose());
  s.append(done);
  sheetHost.append(s);

  // 각 행의 입력창 추적(완료 시 일괄 저장). renderList가 새로 채움
  let editors = [];

  // 완료/× → 편집한 모든 행 + 입력 중인 새 품목을 한 번에 저장하고 닫기
  async function saveAllAndClose() {
    const newName = nameI.value.trim();
    const dirty = editors.filter((e) => {
      const nm = e.nI.value.trim();
      return nm && (nm !== e.r.name || (Number(e.pI.value) || 0) !== e.r.price);
    });
    // 저장할 게 없으면 그냥 닫기
    if (!newName && dirty.length === 0) { closeSheet(); return; }
    if (isOffline()) { showError("오프라인 상태예요. 추천 품목 편집은 인터넷 연결 후 가능해요"); return; }

    done.disabled = true;
    let saved = 0, failed = 0;
    // 1) 입력 중이던 새 품목이 있으면 추가
    if (newName) {
      const ok = await addCatalogItem(cat, newName, Number(priceI.value) || 0);
      if (ok) { nameI.value = ""; priceI.value = ""; saved++; } else { failed++; }
    }
    // 2) 변경된 행들 저장
    for (const e of dirty) {
      const ok = await updateCatalogItem(e.r.id, { name: e.nI.value.trim(), price: Number(e.pI.value) || 0 });
      if (ok) saved++; else failed++;
    }
    done.disabled = false;

    if (saved) showNotice(`${saved}개 저장했어요`);
    // 실패(중복 이름 등)가 있으면 닫지 않고 고칠 수 있게 둠
    if (failed > 0) { renderList(); return; }
    closeSheet();
  }

  function renderList() {
    list.innerHTML = "";
    editors = [];
    const rows = catalogFor(cat);
    if (rows.length === 0) {
      list.append(el("div", "cat-empty", "아직 추천 품목이 없어요. 위에서 추가해 보세요"));
      return;
    }
    rows.forEach((r) => {
      const row = el("div", "cat-row");
      const nI = el("input", "fld cat-name");
      nI.value = r.name;
      const pI = el("input", "fld fld--price cat-price");
      pI.setAttribute("inputmode", "numeric");
      pI.value = String(r.price);
      pI.addEventListener("input", () => { pI.value = pI.value.replace(/[^0-9]/g, ""); });
      // 변경되면 행 강조(완료 시 저장될 항목 표시)
      const mark = () => {
        const changed = nI.value.trim() !== r.name || (Number(pI.value) || 0) !== r.price;
        row.classList.toggle("cat-row--dirty", changed);
      };
      nI.addEventListener("input", mark);
      pI.addEventListener("input", mark);
      const del = el("button", "cat-del", "삭제");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!(await askConfirm(`'${r.name}'을(를) 추천 목록에서 지울까요?`))) return;
        const ok = await deleteCatalogItem(r.id);
        if (ok) renderList();
      });
      row.append(nI, pI, del);
      list.append(row);
      editors.push({ r, nI, pI });
    });
  }
  renderList();
}

// ===== 필터 시트 =====
function openFilterSheet() {
  sheet = "filter";
  buildFilterSheet();
  showBackdrop();
}
function buildFilterSheet() {
  sheetHost.innerHTML = "";
  const reset = el("button", "sheet-link", "초기화");
  reset.type = "button";
  reset.addEventListener("click", () => { filterCats = []; filterPris = []; renderFilterBody(); render(); });
  const s = sheetShell("필터", reset);
  const body = el("div", "sheet-body sh");
  s.append(body);
  const apply = el("button", "sheet-primary", "");
  apply.type = "button";
  apply.addEventListener("click", closeSheet);
  s.append(apply);
  sheetHost.append(s);

  function renderFilterBody() {
    body.innerHTML = "";
    // 프리셋
    body.append(el("div", "field-label", "빠른 선택"));
    const presetRow = el("div", "preset-row");
    const isAll = filterCats.length === 0 && filterPris.length === 0;
    const isUrgent = filterPris.length === 2 && filterPris.includes(1) && filterPris.includes(2) && filterCats.length === 0;
    const isMust = filterPris.length === 1 && filterPris[0] === 1 && filterCats.length === 0;
    presetRow.append(
      makePreset("전체", isAll, () => { filterCats = []; filterPris = []; done(); }),
      makePreset("급한 것만", isUrgent, () => { filterCats = []; filterPris = [1, 2]; done(); }, "preset-danger"),
      makePreset("필수만", isMust, () => { filterCats = []; filterPris = [1]; done(); }, "preset-danger")
    );
    body.append(presetRow);

    // 분류
    const catHead = el("div", "field-row");
    catHead.append(el("span", "field-label", "분류"));
    const catToggle = el("button", "sheet-link", filterCats.length === 0 ? "전체 선택됨" : "모두 해제");
    catToggle.style.color = "#4f46e5";
    catToggle.type = "button";
    catToggle.addEventListener("click", () => { filterCats = []; done(); });
    catHead.append(catToggle);
    body.append(catHead);
    const fchips = el("div", "fchips");
    Object.keys(CATEGORIES).forEach((c) => {
      const on = filterCats.includes(c);
      const b = el("button", "fchip" + (on ? " is-on" : ""), c);
      b.type = "button";
      b.addEventListener("click", () => {
        filterCats = on ? filterCats.filter((x) => x !== c) : [...filterCats, c];
        done();
      });
      fchips.append(b);
    });
    body.append(fchips);

    // 중요도
    const priHead = el("div", "field-row");
    priHead.append(el("span", "field-label", "중요도"));
    const priToggle = el("button", "sheet-link", filterPris.length === 0 ? "전체 선택됨" : "모두 해제");
    priToggle.style.color = "#4f46e5";
    priToggle.type = "button";
    priToggle.addEventListener("click", () => { filterPris = []; done(); });
    priHead.append(priToggle);
    body.append(priHead);
    const priList = el("div", "fpri-list");
    PRIORITIES.forEach((p) => {
      const on = filterPris.includes(p.value);
      const rowEl = el("div", "fpri-row" + (on ? " is-on" : ""));
      const dot = el("span", "pri-dot");
      dot.style.cssText = "width:11px;height:11px";
      dot.style.background = p.color;
      const label = el("span", "fpri-label", p.label);
      const check = el("span", "fpri-check", on ? "✓" : "");
      rowEl.append(dot, label, check);
      rowEl.addEventListener("click", () => {
        filterPris = on ? filterPris.filter((x) => x !== p.value) : [...filterPris, p.value];
        done();
      });
      priList.append(rowEl);
    });
    body.append(priList);

    // 적용 버튼 개수
    const fcount = currentPool().filter(
      (x) => (filterCats.length === 0 || filterCats.includes(x.cat)) && (filterPris.length === 0 || filterPris.includes(x.priority))
    ).length;
    apply.textContent = fcount + "개 품목 보기";
  }
  function makePreset(label, on, onClick, extra) {
    const b = el("button", "preset" + (extra ? " " + extra : "") + (on ? " is-on" : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function done() { renderFilterBody(); render(); } // 필터는 즉시 적용(뒤 화면도 갱신)
  renderFilterBody();
}

// ===== 수정 시트 =====
let editSugTimer;
function openEditSheet(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  edit = { id: it.id, name: it.name, price: it.price, qty: it.qty, cat: it.cat, pri: it.priority, _orig: it.name };
  sheet = "edit";
  buildEditSheet();
  showBackdrop();
}
function buildEditSheet() {
  sheetHost.innerHTML = "";
  const s = el("div", "sheet");
  s.append(el("div", "sheet-handle"));

  // 헤더: 이름/분류 + 합계/단가
  const head = el("div", "edit-head");
  const ehLeft = el("div", "eh-left");
  const ehName = el("div", "eh-name", edit.name);
  const ehCat = el("div", "eh-cat", edit.cat);
  ehLeft.append(ehName, ehCat);
  const ehRight = el("div", "eh-right");
  const ehTotal = el("div", "eh-total");
  const ehUnit = el("div", "eh-unit");
  ehRight.append(ehTotal, ehUnit);
  head.append(ehLeft, ehRight);
  s.append(head);

  const body = el("div", "sheet-body sh");

  // 분류 칩 (디자인 목업엔 없지만, 분류 변경 기능 보존)
  body.append(el("div", "field-label", "분류"));
  const catScroll = el("div", "chip-scroll sh");
  const catBtns = [];
  Object.keys(CATEGORIES).forEach((c) => {
    const b = el("button", "chip-pick" + (edit.cat === c ? " is-on" : ""), c);
    b.type = "button";
    b.addEventListener("click", () => {
      edit.cat = c;
      catBtns.forEach((x) => x.b.classList.toggle("is-on", x.c === c));
      ehCat.textContent = c;
    });
    catBtns.push({ b, c });
    catScroll.append(b);
  });
  body.append(catScroll);

  // 품목명 + 네이버 추천
  body.append(el("div", "field-label", "품목명"));
  const nameInput = el("input", "fld");
  nameInput.value = edit.name;
  nameInput.style.marginBottom = "10px";
  body.append(nameInput);
  const editSugs = el("div", "sugs");
  editSugs.hidden = true;
  body.append(editSugs);
  nameInput.addEventListener("input", () => {
    edit.name = nameInput.value;
    ehName.textContent = nameInput.value;
    clearTimeout(editSugTimer);
    const q = nameInput.value.trim();
    if (q.length < 2) { editSugs.hidden = true; editSugs.innerHTML = ""; return; }
    editSugTimer = setTimeout(async () => {
      try {
        const sugs = await searchNaver(q);
        if (nameInput.value.trim() !== q) return;
        renderSugsInto(editSugs, sugs, (sug) => {
          edit.name = summarizeName(sug.title);
          edit.price = Number(sug.lprice) || 0;
          nameInput.value = edit.name;
          priceInput.value = String(edit.price);
          ehName.textContent = edit.name;
          updateEditHeader();
          editSugs.hidden = true; editSugs.innerHTML = "";
        });
      } catch { editSugs.hidden = true; }
    }, 350);
  });

  // 가격 + 수량
  const two = el("div", "two-col");
  const colPrice = el("div", "col-price");
  colPrice.append(el("div", "field-label", "가격"));
  const priceInput = el("input", "fld fld--price");
  priceInput.setAttribute("inputmode", "numeric");
  priceInput.value = String(edit.price);
  priceInput.addEventListener("input", () => {
    priceInput.value = priceInput.value.replace(/[^0-9]/g, "");
    edit.price = Number(priceInput.value) || 0;
    updateEditHeader();
  });
  colPrice.append(priceInput);
  const colQty = el("div", "col-qty");
  colQty.append(el("div", "field-label", "수량"));
  colQty.append(stepper(() => edit.qty, (v) => { edit.qty = v; updateEditHeader(); }));
  two.append(colPrice, colQty);
  body.append(two);

  // 중요도
  const priHead = el("div", "field-row");
  priHead.append(el("span", "field-label", "중요도"));
  const cur = el("span", "field-cur");
  const curDot = el("span", "pri-dot");
  const curLabel = el("span");
  cur.append(curDot, curLabel);
  priHead.append(cur);
  body.append(priHead);
  const seg = buildPriSegments(() => edit.pri, (v) => {
    edit.pri = v;
    curDot.style.background = priorityInfo(v).color;
    curLabel.textContent = priorityInfo(v).label;
  });
  curDot.style.background = priorityInfo(edit.pri).color;
  curLabel.textContent = priorityInfo(edit.pri).label;
  body.append(seg.row);

  s.append(body);

  // 삭제 / 저장
  const actions = el("div", "edit-actions");
  const del = el("button", "edit-del", "삭제");
  del.type = "button";
  del.addEventListener("click", async () => {
    if (!(await askConfirm(`'${edit.name}'을(를) 삭제할까요?`))) return;
    const id = edit.id;
    closeSheet();
    deleteItem(id);
  });
  const save = el("button", "edit-save", "저장");
  save.type = "button";
  save.addEventListener("click", () => {
    const nm = (edit.name || "").trim() || edit._orig;
    const id = edit.id;
    const patch = { cat: edit.cat, name: nm, price: Number(edit.price) || 0, qty: Math.max(1, edit.qty || 1), priority: edit.pri };
    closeSheet();
    updateItem(id, patch);
  });
  actions.append(del, save);
  s.append(actions);
  sheetHost.append(s);

  function updateEditHeader() {
    ehTotal.textContent = money((Number(edit.price) || 0) * (edit.qty || 1));
    ehUnit.textContent = money(Number(edit.price) || 0) + " × " + (edit.qty || 1);
  }
  updateEditHeader();
}

// ===== 삭제 확인 대화상자 =====
const confirmBackdrop = document.getElementById("confirm-backdrop");
const confirmMsg = document.getElementById("confirm-msg");
const confirmOk = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");
let confirmResolve = null;
function askConfirm(message) {
  confirmMsg.textContent = message;
  confirmBackdrop.hidden = false;
  return new Promise((resolve) => (confirmResolve = resolve));
}
function settleConfirm(result) {
  confirmBackdrop.hidden = true;
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
confirmOk.addEventListener("click", () => settleConfirm(true));
confirmCancel.addEventListener("click", () => settleConfirm(false));
confirmBackdrop.addEventListener("click", (e) => { if (e.target === confirmBackdrop) settleConfirm(false); });

// ===== 전역 이벤트 =====
fab.addEventListener("click", () => openAddSheet());
sheetBackdrop.addEventListener("click", closeSheet);

document.addEventListener("visibilitychange", () => { if (!document.hidden) loadItems(); });
window.addEventListener("online", () => { updateOfflineBanner(); loadItems(); });
window.addEventListener("offline", updateOfflineBanner);

// ===== 시작 =====
async function init() {
  loadCache();
  loadCatalogCache();
  loadQueue();
  render();
  updateOfflineBanner();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (!isOffline()) {
    await migrateLocal();
    await loadItems();
  }
}
init();
