// ===== Supabase 연결 =====
// createClient(주소, 공개키): 이 키(publishable)는 브라우저에 노출돼도 되는 키.
// 실제 권한은 DB의 RLS 정책이 결정함.
const SUPABASE_URL = "https://czkdfopmbfdlxtegwgav.supabase.co";
const SUPABASE_KEY = "sb_publishable_YTFDp9WweP3alI-71yE4rg_UMbpQFMS";
// 오프라인 첫 방문 등으로 CDN 라이브러리를 못 불러왔으면 sb는 null —
// 이 경우에도 아래 코드가 죽지 않고 "캐시 보기 전용"으로 동작해야 함
const sb = window.supabase ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ===== 상태 =====
// item 구조: { id, name, price, qty, done, cat, priority, created_at }
// id는 DB가 만들어 주는 고유값. 이제 배열 index 대신 id로 항목을 찾음.
let items = [];
let filterCat = null; // null이면 전체
let filterPri = null; // null이면 전체
let view = "cart"; // "cart"(장바구니) | "history"(구매 기록)
// 선택된 항목의 id 모음. DB에는 저장하지 않는 화면 전용 상태 —
// 체크는 "고르기"만 하고, 실제 구매완료 처리는 버튼을 눌러야 실행됨.
let selected = new Set();

const form = document.getElementById("add-form");
const catSelect = document.getElementById("cat-select");
const subSelect = document.getElementById("sub-select");
const priSelect = document.getElementById("pri-select");
const nameInput = document.getElementById("item-name");
const priceInput = document.getElementById("item-price");
const qtyInput = document.getElementById("item-qty");
const list = document.getElementById("item-list");
const totalEl = document.getElementById("total");
const totalLabel = document.getElementById("total-label");
const clearBtn = document.getElementById("clear-btn");
const errorBanner = document.getElementById("error-banner");
const tabCart = document.getElementById("tab-cart");
const tabHistory = document.getElementById("tab-history");
const hintEl = document.querySelector(".hint");
const selectAllBar = document.getElementById("select-all-bar");
const checkAll = document.getElementById("check-all");
const applyBtn = document.getElementById("apply-selected");

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
  setTimeout(() => (errorBanner.hidden = true), 4000);
}

// ===== 오프라인 지원 =====
// 전략: 목록을 항상 localStorage에 복사해 둠(캐시).
// 오프라인이면 캐시를 보여주기만 하고, 변경(추가/수정/삭제)은 막음.
const offlineBanner = document.getElementById("offline-banner");
const CACHE_KEY = "cart-cache";

// navigator.onLine: 브라우저가 알려주는 현재 연결 상태
function isOffline() {
  return !navigator.onLine || !sb;
}

function updateOfflineBanner() {
  offlineBanner.hidden = !isOffline();
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {} // 저장 실패(용량 초과 등)해도 앱은 계속 동작
}

function loadCache() {
  try {
    items = JSON.parse(localStorage.getItem(CACHE_KEY)) || [];
  } catch {
    items = [];
  }
}

// ===== 오프라인 변경 큐 =====
// 오프라인에서 한 변경(추가/수정/삭제)을 기기에 줄 세워 두고,
// 다시 연결되면 순서대로 서버에 보냄(동기화).
// 큐에 들어가는 작업(op) 3종:
//   { kind: "add",    row }            — 새 행 전체 (id도 미리 만들어 둠)
//   { kind: "update", id, patch, ts }  — 어떤 행을 어떻게 고칠지 + 고친 시각
//   { kind: "delete", id, ts }
const QUEUE_KEY = "cart-queue";
let queue = [];

function loadQueue() {
  try {
    queue = JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    queue = [];
  }
}

function saveQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

// id(uuid)를 클라이언트가 직접 생성 — DB가 만들어 주길 기다릴 필요가 없어
// 오프라인에서도 "진짜 id"를 가진 항목을 만들 수 있음.
// 같은 id를 두 번 insert하면 DB가 거부하므로, 재전송이 겹쳐도 중복 저장이 안 됨.
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // 아주 오래된 브라우저용 대체 (uuid v4 형식 흉내)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// 초록색 안내 배너 (에러 배너를 색만 바꿔 재사용)
function showNotice(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add("notice");
  errorBanner.hidden = false;
  setTimeout(() => {
    errorBanner.hidden = true;
    errorBanner.classList.remove("notice");
  }, 4000);
}

// 오프라인 수정: 큐에 넣고 화면에는 바로 반영
function queueUpdate(id, patch) {
  const ts = new Date().toISOString();
  // 아직 서버에 안 올라간 "추가" 항목을 고치는 거면, 큐의 add에 합쳐 버림
  const addOp = queue.find((op) => op.kind === "add" && op.row.id === id);
  if (addOp) {
    Object.assign(addOp.row, patch, { updated_at: ts });
  } else {
    // 같은 항목을 여러 번 고치면 op을 하나로 합침 (마지막 상태만 보내면 됨)
    const upOp = queue.find((op) => op.kind === "update" && op.id === id);
    if (upOp) {
      Object.assign(upOp.patch, patch);
      upOp.ts = ts;
    } else {
      queue.push({ kind: "update", id, patch: { ...patch }, ts });
    }
  }
  saveQueue();
  const i = items.findIndex((x) => x.id === id);
  if (i !== -1) items[i] = { ...items[i], ...patch, updated_at: ts, pending: true };
}

// 오프라인 삭제: 아직 서버에 없는 항목이면 큐에서 빼기만 하면 끝
function queueDelete(id) {
  const wasLocalAdd = queue.some((op) => op.kind === "add" && op.row.id === id);
  queue = queue.filter(
    (op) =>
      !(op.kind === "add" && op.row.id === id) &&
      !(op.kind === "update" && op.id === id)
  );
  if (!wasLocalAdd) queue.push({ kind: "delete", id, ts: new Date().toISOString() });
  saveQueue();
  items = items.filter((x) => x.id !== id);
}

// 서버에서 받은 목록 위에 "아직 안 보낸 변경"을 겹쳐 그림
// (큐가 남아 있는 동안 새로고침해도 내 변경이 사라져 보이지 않게)
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

// ===== 재접속 동기화 =====
// 큐를 앞에서부터 하나씩 서버로 보냄. 충돌 규칙(last-write-wins):
// "더 나중에 고친 쪽이 이긴다" — 각 op의 ts와 서버의 updated_at을 비교해서
// 서버가 더 최신이면 내 변경은 버리고 서버 내용을 따름.
let flushing = false;

async function flushQueue() {
  if (flushing || isOffline() || queue.length === 0) return;
  flushing = true;
  let sent = 0;      // 서버에 반영된 op 수
  let conflicts = 0; // 서버가 더 최신이라 버려진 op 수
  try {
    while (queue.length > 0 && !isOffline()) {
      const op = queue[0];

      if (op.kind === "add") {
        const { error } = await sb.from("cart_items").insert(op.row);
        // 23505 = 이미 같은 id가 있음(지난 전송이 사실은 성공했던 경우) → 성공 취급
        if (error && error.code !== "23505") {
          if (!error.code) break; // code 없는 에러 = 네트워크 문제 → 큐 유지, 다음에 재시도
          showError("저장하지 못한 항목이 있어요: " + op.row.name);
        }
      } else if (op.kind === "update") {
        // .lte("updated_at", op.ts): 서버 행이 내 수정 시각보다 예전일 때만 반영.
        // 다른 기기가 그 사이 더 최근에 고쳤으면 0행 매치 → 내 수정은 버려짐(충돌)
        const { data, error } = await sb
          .from("cart_items")
          .update({ ...op.patch, updated_at: op.ts })
          .eq("id", op.id)
          .lte("updated_at", op.ts)
          .select();
        if (error) {
          if (!error.code) break;
          showError("수정을 반영하지 못한 항목이 있어요");
        } else if (data.length === 0) conflicts++;
      } else if (op.kind === "delete") {
        const { data, error } = await sb
          .from("cart_items")
          .delete()
          .eq("id", op.id)
          .lte("updated_at", op.ts)
          .select();
        if (error) {
          if (!error.code) break;
        } else if (data.length === 0) {
          // 못 지웠음: 이미 없어진 행(문제 없음)이거나, 다른 기기가 최근에 고친 행(충돌)
          const { data: still } = await sb
            .from("cart_items")
            .select("id")
            .eq("id", op.id);
          if (still && still.length > 0) conflicts++;
        }
      }

      queue.shift(); // 처리 끝난 op 제거
      saveQueue();
      sent++;
    }
  } catch {
    // 전송 중 연결이 끊기면 남은 큐는 다음 재연결 때 이어서 보냄
  }
  flushing = false;

  if (sent > 0) {
    await fetchItems(); // 서버 기준 최신 목록으로 갱신
    if (conflicts > 0) {
      showNotice(`다른 기기에서 더 최근에 바뀐 ${conflicts}건은 서버 내용을 따랐어요`);
    } else {
      showNotice(`오프라인 변경 ${sent}건을 서버에 반영했어요`);
    }
  }
}

// ===== 품목명 요약 (규칙 기반) =====
// 네이버 상품명은 "[특가] 브랜드 상품 1L x 10팩 당일발송" 처럼 길어서
// 광고 문구를 제거하고 핵심(브랜드/상품/용량)만 남김
const NOISE_WORDS = [
  "무료배송", "국내배송", "당일발송", "당일출고", "빠른배송", "초특가",
  "사은품증정", "공식판매점", "본사직영", "정품", "특가", "최저가",
  "할인", "세일", "이벤트", "증정", "사은품", "베스트", "인기",
  "신상품", "공식", "본사",
];

// 용량/수량 단어인지 검사 (1L, 500ml, 10팩, x6, 3개입 같은 것)
function isUnitWord(w) {
  return /\d+\s*(ml|l|g|kg|개입|개|매|롤|팩|입|구|병|캔|박스|포|모|단|송이|마리)/i.test(w)
    || /^x\s*\d+$/i.test(w);
}

function summarizeName(title) {
  let t = title;
  // 1) [대괄호] 묶음은 거의 광고라 통째로 제거
  t = t.replace(/\[[^\]]*\]/g, " ");
  // 2) (괄호)는 안에 용량/수량이 있으면 남기고, 아니면 제거
  t = t.replace(/\(([^)]*)\)/g, (m, inner) => (isUnitWord(inner) ? m : " "));
  // 3) 광고 문구 제거 (긴 단어부터 — 짧은 단어가 먼저 지워지면 조각이 남음)
  NOISE_WORDS.forEach((w) => {
    t = t.split(w).join(" ");
  });
  // 4) 장식용 특수문자 제거 + 공백 정리
  t = t.replace(/[★☆♥●■◆◈™®]/g, " ").replace(/\s{2,}/g, " ").trim();
  // 5) 반복 단어 제거 (상품명에 같은 단어가 두 번 들어가는 경우 흔함)
  const seen = new Set();
  let words = t.split(" ").filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // 6) 그래도 길면: 앞쪽 3단어(브랜드+상품) + 용량/수량 단어만 유지
  if (words.join(" ").length > 25) {
    words = words.filter((w, i) => i < 3 || isUnitWord(w));
  }
  const out = words.join(" ").trim();
  return out || title; // 다 지워져 버렸으면 원본 그대로
}

// ===== DB 함수 =====
// async/await: DB 요청은 시간이 걸리므로 응답을 기다렸다가 다음 줄을 실행

// 서버에서 목록을 받아와, 아직 못 보낸 큐 내용을 겹쳐서 그림
async function fetchItems() {
  const { data, error } = await sb
    .from("cart_items")
    .select("*")
    .order("created_at"); // 추가한 순서대로
  if (error) return showError("목록을 불러오지 못했어요");
  items = applyQueue(data);
  render();
}

async function loadItems() {
  if (isOffline()) return updateOfflineBanner(); // 캐시 화면 유지
  if (queue.length > 0) return flushQueue(); // 밀린 변경 먼저 보내고, 끝나면 fetchItems 호출됨
  await fetchItems();
}

async function addItem(fields) {
  if (isOffline()) {
    // 오프라인: id를 여기서 만들어 큐에 넣고, 화면에는 바로 추가
    const now = new Date().toISOString();
    const row = { id: newId(), ...fields, created_at: now, updated_at: now };
    queue.push({ kind: "add", row });
    saveQueue();
    items.push({ ...row, pending: true });
    return render();
  }
  // insert 후 .select().single(): 방금 넣은 행(id 포함)을 돌려받음
  const { data, error } = await sb
    .from("cart_items")
    .insert(fields)
    .select()
    .single();
  if (error) return showError("저장에 실패했어요");
  items.push(data);
  render();
}

async function updateItem(id, patch) {
  if (isOffline()) {
    queueUpdate(id, patch);
    return render();
  }
  // 온라인 수정에도 updated_at을 남김 — 충돌 판정(누가 더 최신인가)의 기준이 됨
  const { data, error } = await sb
    .from("cart_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id) // id가 일치하는 행만
    .select()
    .single();
  if (error) return showError("수정에 실패했어요");
  const i = items.findIndex((x) => x.id === id);
  if (i !== -1) items[i] = data;
  render();
}

async function deleteItem(id) {
  if (isOffline()) {
    queueDelete(id);
    return render();
  }
  const { error } = await sb.from("cart_items").delete().eq("id", id);
  if (error) return showError("삭제에 실패했어요");
  items = items.filter((x) => x.id !== id);
  render();
}

// 전체 비우기: "전체 선택"이 켜져 있을 때만 버튼이 보이고,
// DB 전체가 아니라 "선택된(=지금 보이는) 항목"만 지움.
// 필터를 걸어 둔 상태라면 필터에 걸린 항목만 지워지므로 더 안전함.
async function deleteSelected() {
  const ids = [...selected];
  if (ids.length === 0) return;
  // 여러 개를 한 번에 지우는 되돌리기 어려운 작업이라 오프라인에서는 막아 둠
  if (isOffline()) return showError("전체 비우기는 인터넷 연결 후 가능해요");
  const { error } = await sb.from("cart_items").delete().in("id", ids);
  if (error) return showError("비우기에 실패했어요");
  selected.clear();
  items = items.filter((x) => !ids.includes(x.id));
  render();
}

// 여러 항목을 한 번의 요청으로 수정 (.in: id가 목록에 포함된 행 전부)
async function bulkUpdate(ids, patch) {
  if (ids.length === 0) return;
  if (isOffline()) {
    // 여러 항목도 결국 "항목별 수정"의 묶음 — 한 개씩 큐에 넣음
    ids.forEach((id) => queueUpdate(id, patch));
    return render();
  }
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

// 구매완료/되돌리기 패치를 만들어 주는 도우미 (체크박스들이 공통으로 사용)
function donePatch(checked) {
  return {
    done: checked,
    purchased_at: checked ? new Date().toISOString() : null,
  };
}

// ===== localStorage → Supabase 마이그레이션 =====
// 예전 버전이 브라우저에 남겨둔 데이터가 있으면 한 번만 DB로 올리고 지움
async function migrateLocal() {
  let old;
  try {
    old = JSON.parse(localStorage.getItem("cart-items")) || [];
  } catch {
    old = [];
  }
  if (old.length === 0) return;

  const rows = old.map((o) => ({
    name: o.name,
    price: Number(o.price) || 0,
    qty: Number(o.qty) || 1,
    done: !!o.done,
    cat: o.cat || "기타",
    priority: 3, // 예전 데이터에는 중요도가 없으니 Normal로
  }));
  const { error } = await sb.from("cart_items").insert(rows);
  if (!error) localStorage.removeItem("cart-items");
}

// ===== 분류/중요도 select 채우기 =====
Object.keys(CATEGORIES).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  catSelect.appendChild(opt);
});

PRIORITIES.forEach((p) => {
  const opt = document.createElement("option");
  opt.value = p.value;
  opt.textContent = p.label;
  priSelect.appendChild(opt);
});
priSelect.value = 3; // 기본값 Normal

// 대분류가 바뀌면 소분류 옵션을 다시 채움
function fillSubOptions() {
  subSelect.innerHTML = "";

  const manual = document.createElement("option");
  manual.value = "";
  manual.textContent = "직접 입력";
  subSelect.appendChild(manual);

  const subs = CATEGORIES[catSelect.value];
  Object.keys(subs).forEach((sub) => {
    const opt = document.createElement("option");
    opt.value = sub;
    opt.textContent = `${sub} — 약 ${subs[sub].toLocaleString()}원`;
    subSelect.appendChild(opt);
  });
}

catSelect.addEventListener("change", fillSubOptions);

subSelect.addEventListener("change", () => {
  const sub = subSelect.value;
  if (!sub) return;
  nameInput.value = sub;
  priceInput.value = CATEGORIES[catSelect.value][sub];
  qtyInput.focus();
});

// ===== 사이드바 (필터 + 드롭 대상) =====
const sideCats = document.getElementById("side-cats");
const sidePris = document.getElementById("side-pris");

// 버튼 하나 만들기: 클릭하면 필터, 드래그해서 놓으면 이동
function makeSideButton({ label, count, color, isActive, onClick, onDrop }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "side-btn" + (isActive ? " active" : "");

  if (color) {
    const dot = document.createElement("span");
    dot.className = "pri-dot";
    dot.style.background = color;
    btn.appendChild(dot);
  }
  const txt = document.createElement("span");
  txt.className = "side-label";
  txt.textContent = label;
  btn.appendChild(txt);

  if (count !== undefined) {
    const cnt = document.createElement("span");
    cnt.className = "side-count";
    cnt.textContent = count;
    btn.appendChild(cnt);
  }

  btn.addEventListener("click", onClick);

  if (onDrop) {
    // dragover에서 preventDefault를 해야 브라우저가 "여기 놓아도 됨"으로 인식함
    btn.addEventListener("dragover", (e) => {
      e.preventDefault();
      btn.classList.add("drop-target");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("drop-target"));
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      btn.classList.remove("drop-target");
      const id = e.dataTransfer.getData("text/plain"); // dragstart에서 넣어둔 id
      if (id) onDrop(id);
    });
  }
  return btn;
}

function renderSidebar() {
  sideCats.innerHTML = "";
  sidePris.innerHTML = "";
  const pool = currentPool(); // 현재 탭(장바구니/기록)에 속한 항목만 개수로 셈

  // "전체" 버튼 (필터 해제)
  sideCats.appendChild(
    makeSideButton({
      label: "전체",
      count: pool.length,
      isActive: filterCat === null,
      onClick: () => {
        filterCat = null;
        render();
      },
    })
  );

  Object.keys(CATEGORIES).forEach((cat) => {
    const count = pool.filter((x) => x.cat === cat).length;
    sideCats.appendChild(
      makeSideButton({
        label: cat,
        count,
        isActive: filterCat === cat,
        // 같은 버튼을 다시 누르면 필터 해제 (토글)
        onClick: () => {
          filterCat = filterCat === cat ? null : cat;
          render();
        },
        onDrop: (id) => updateItem(id, { cat }),
      })
    );
  });

  sidePris.appendChild(
    makeSideButton({
      label: "전체",
      isActive: filterPri === null,
      onClick: () => {
        filterPri = null;
        render();
      },
    })
  );

  PRIORITIES.forEach((p) => {
    const count = pool.filter((x) => x.priority === p.value).length;
    sidePris.appendChild(
      makeSideButton({
        label: p.label,
        count,
        color: p.color,
        isActive: filterPri === p.value,
        onClick: () => {
          filterPri = filterPri === p.value ? null : p.value;
          render();
        },
        onDrop: (id) => updateItem(id, { priority: p.value }),
      })
    );
  });
}

// ===== 네이버 쇼핑 추천 (추가 폼) =====
const sugBox = document.getElementById("suggestions");

let debounceTimer;
nameInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const q = nameInput.value.trim();
  if (q.length < 2) {
    hideSuggestions();
    return;
  }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
});

async function fetchSuggestions(q) {
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    if (!res.ok) throw new Error("api error");
    const data = await res.json();
    if (nameInput.value.trim() !== q) return;
    renderSuggestions(data.items);
  } catch {
    hideSuggestions();
  }
}

function renderSuggestions(sugs) {
  sugBox.innerHTML = "";
  if (!sugs || sugs.length === 0) {
    hideSuggestions();
    return;
  }

  const label = document.createElement("div");
  label.className = "sug-label";
  label.textContent = "네이버 쇼핑 최저가 (클릭하면 입력됨)";
  sugBox.appendChild(label);

  sugs.forEach((s) => {
    const div = document.createElement("div");
    div.className = "sug-item";

    const nm = document.createElement("span");
    nm.className = "sug-name";
    nm.textContent = s.title;

    const pr = document.createElement("span");
    pr.className = "sug-price";
    pr.textContent = s.lprice.toLocaleString() + "원";

    div.append(nm, pr);
    div.addEventListener("click", () => {
      // 긴 상품명은 요약해서 입력 (마음에 안 들면 그냥 수정하면 됨)
      nameInput.value = summarizeName(s.title);
      priceInput.value = s.lprice;
      hideSuggestions();
      qtyInput.focus();
    });
    sugBox.appendChild(div);
  });

  sugBox.hidden = false;
}

function hideSuggestions() {
  sugBox.innerHTML = "";
  sugBox.hidden = true;
}

document.addEventListener("click", (e) => {
  if (!sugBox.contains(e.target) && e.target !== nameInput) {
    hideSuggestions();
  }
});

// ===== 상세/수정 모달 =====
const backdrop = document.getElementById("modal-backdrop");
const editCat = document.getElementById("edit-cat");
const editPri = document.getElementById("edit-pri");
const editName = document.getElementById("edit-name");
const editPrice = document.getElementById("edit-price");
const editQty = document.getElementById("edit-qty");
const editSugs = document.getElementById("edit-sugs");
const editSave = document.getElementById("edit-save");
const editSummarize = document.getElementById("edit-summarize");
const editCancel = document.getElementById("edit-cancel");
const editDelete = document.getElementById("edit-delete");

let editingId = null; // 지금 수정 중인 항목의 id

Object.keys(CATEGORIES).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  editCat.appendChild(opt);
});

PRIORITIES.forEach((p) => {
  const opt = document.createElement("option");
  opt.value = p.value;
  opt.textContent = p.label;
  editPri.appendChild(opt);
});

function openDetail(id) {
  const item = items.find((x) => x.id === id);
  if (!item) return;
  editingId = id;
  editCat.value = item.cat;
  editPri.value = item.priority;
  editName.value = item.name;
  editPrice.value = item.price;
  editQty.value = item.qty;
  backdrop.hidden = false;
  loadEditSuggestions(item.name);
}

async function loadEditSuggestions(q) {
  editSugs.innerHTML = '<p class="sug-loading">추천 가격 불러오는 중…</p>';
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    if (!res.ok) throw new Error("api error");
    const data = await res.json();
    renderEditSuggestions(data.items);
  } catch {
    editSugs.innerHTML = '<p class="sug-empty">추천을 불러오지 못했어요</p>';
  }
}

function renderEditSuggestions(sugs) {
  editSugs.innerHTML = "";
  if (!sugs || sugs.length === 0) {
    editSugs.innerHTML = '<p class="sug-empty">추천 결과 없음</p>';
    return;
  }

  const label = document.createElement("div");
  label.className = "sug-label";
  label.textContent = "네이버 쇼핑 최저가 (클릭하면 가격에 반영)";
  editSugs.appendChild(label);

  sugs.forEach((s) => {
    const div = document.createElement("div");
    div.className = "sug-item";

    const nm = document.createElement("span");
    nm.className = "sug-name";
    nm.textContent = s.title;

    const pr = document.createElement("span");
    pr.className = "sug-price";
    pr.textContent = s.lprice.toLocaleString() + "원";

    div.append(nm, pr);
    div.addEventListener("click", () => {
      editPrice.value = s.lprice;
    });
    editSugs.appendChild(div);
  });
}

let editDebounce;
editName.addEventListener("input", () => {
  clearTimeout(editDebounce);
  const q = editName.value.trim();
  if (q.length < 2) return;
  editDebounce = setTimeout(() => loadEditSuggestions(q), 400);
});

// "요약" 버튼: 지금 입력된 품목명을 규칙 기반으로 줄임
editSummarize.addEventListener("click", () => {
  editName.value = summarizeName(editName.value);
});

function closeDetail() {
  backdrop.hidden = true;
  editingId = null;
}

editSave.addEventListener("click", () => {
  if (editingId === null) return;
  const name = editName.value.trim();
  if (!name) return editName.focus();

  updateItem(editingId, {
    cat: editCat.value,
    priority: Number(editPri.value),
    name,
    price: Number(editPrice.value) || 0,
    qty: Math.max(1, Number(editQty.value) || 1),
  });
  closeDetail();
});

editDelete.addEventListener("click", async () => {
  if (editingId === null) return;
  if (!(await askConfirm("이 품목을 삭제할까요?"))) return;
  deleteItem(editingId);
  closeDetail();
});

editCancel.addEventListener("click", closeDetail);

backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) closeDetail();
});

// ===== 화면 그리기 =====
// 현재 탭에 맞는 항목 풀: 장바구니는 미구매(done=false), 기록은 구매 완료(done=true)
function currentPool() {
  return items.filter((x) => (view === "cart" ? !x.done : x.done));
}

// ISO 시각 → "2026-07-18" 형태의 날짜 라벨
function dateLabel(iso) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 현재 탭 + 필터를 모두 통과한 항목들
function visibleItems() {
  return currentPool().filter(
    (x) =>
      (filterCat === null || x.cat === filterCat) &&
      (filterPri === null || x.priority === filterPri)
  );
}

function render() {
  saveCache(); // 화면을 그릴 때마다 현재 목록을 기기에 저장 (오프라인 대비)
  renderSidebar();
  list.innerHTML = "";

  // 탭 활성 표시 + 기록 화면에서는 입력 폼/안내문/비우기 버튼 숨김
  tabCart.classList.toggle("active", view === "cart");
  tabHistory.classList.toggle("active", view === "history");
  form.hidden = view !== "cart";
  hintEl.hidden = view !== "cart";

  // 현재 필터에 맞는 항목만 (분류 필터와 중요도 필터는 동시에 적용 가능)
  const visible = visibleItems();

  // 화면에 없는 항목이 몰래 처리되지 않게, 선택은 "지금 보이는 항목"으로만 유지
  // (탭이나 필터를 바꾸면 가려진 항목은 선택에서 빠짐)
  const visibleIds = new Set(visible.map((x) => x.id));
  selected.forEach((id) => {
    if (!visibleIds.has(id)) selected.delete(id);
  });

  // 전체 선택 바: 보이는 품목이 있을 때만 표시, "모두 선택됐는지" 상태 반영
  selectAllBar.hidden = visible.length === 0;
  checkAll.checked = visible.length > 0 && visible.every((x) => selected.has(x.id));

  // 처리 버튼: 선택된 게 있을 때만 보이고, 몇 개를 처리할지 개수 표시
  applyBtn.hidden = selected.size === 0;
  applyBtn.textContent =
    (view === "cart" ? "구매 완료" : "장바구니로 되돌리기") + ` (${selected.size})`;

  // 전체 비우기 버튼: 장바구니 탭 + "전체 선택"이 켜져 있을 때만 표시 (실수 방지)
  clearBtn.hidden = view !== "cart" || !checkAll.checked;
  clearBtn.textContent = `전체 비우기 (${selected.size})`;

  if (visible.length === 0) {
    if (view === "history" && currentPool().length === 0) {
      list.innerHTML = '<p class="loading">아직 구매 기록이 없어요</p>';
    } else if (items.length > 0) {
      list.innerHTML = '<p class="loading">이 필터에 해당하는 품목이 없어요</p>';
    }
  }

  // 묶음 만들기: 장바구니는 분류별, 기록은 구매 날짜별(최신 날짜가 위)
  let groups;
  if (view === "cart") {
    groups = Object.keys(CATEGORIES)
      .map((cat) => ({ label: cat, rows: visible.filter((i) => i.cat === cat) }))
      .filter((g) => g.rows.length > 0);
  } else {
    const byDate = {};
    visible.forEach((i) => {
      const key = i.purchased_at ? dateLabel(i.purchased_at) : "날짜 없음";
      (byDate[key] = byDate[key] || []).push(i);
    });
    const keys = Object.keys(byDate).sort().reverse();
    // 혹시 날짜가 없는 옛 데이터가 있으면 맨 아래로
    keys.sort((a, b) => (a === "날짜 없음" ? 1 : 0) - (b === "날짜 없음" ? 1 : 0));
    groups = keys.map((key) => ({ label: "🧾 " + key, rows: byDate[key] }));
  }

  groups.forEach((g) => {
    const heading = document.createElement("div");
    heading.className = "group-heading";
    const subtotal = g.rows.reduce((sum, item) => sum + item.price * item.qty, 0);

    // 분류(또는 날짜) 전체를 한 번에 선택/해제하는 체크박스 (선택만, 처리는 버튼)
    const gCheck = document.createElement("input");
    gCheck.type = "checkbox";
    gCheck.checked = g.rows.every((x) => selected.has(x.id));
    gCheck.addEventListener("change", () => {
      g.rows.forEach((x) =>
        gCheck.checked ? selected.add(x.id) : selected.delete(x.id)
      );
      render(); // 전체 선택 체크 상태와 버튼 개수를 다시 계산
    });

    const left = document.createElement("span");
    left.className = "group-left";
    const title = document.createElement("span");
    title.textContent = g.label;
    left.append(gCheck, title);

    const right = document.createElement("span");
    right.textContent = subtotal.toLocaleString() + "원";

    heading.append(left, right);
    list.appendChild(heading);

    const ul = document.createElement("ul");

    g.rows.forEach((item) => {
      const li = document.createElement("li");

      // 드래그 시작: 이 항목의 id를 실어 보냄 → 사이드바 drop에서 꺼내 씀
      li.draggable = true;
      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", item.id);
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(item.id);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        // 체크 = 선택만. 실제 구매완료/되돌리기는 위의 버튼이 실행
        if (checkbox.checked) selected.add(item.id);
        else selected.delete(item.id);
        render();
      });

      // 중요도 배지 (색 + 라벨)
      const p = priorityInfo(item.priority);
      const badge = document.createElement("span");
      badge.className = "pri-badge";
      badge.style.background = p.color;
      badge.textContent = p.label;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `${item.name} × ${item.qty}`;

      // 아직 서버에 안 올라간(큐 대기 중) 항목이면 ⏳ 표시
      let pendingTag = null;
      if (item.pending) {
        li.classList.add("pending");
        pendingTag = document.createElement("span");
        pendingTag.className = "pending-tag";
        pendingTag.textContent = "⏳";
        pendingTag.title = "연결되면 자동 저장돼요";
      }

      const price = document.createElement("span");
      price.className = "price";
      price.textContent = (item.price * item.qty).toLocaleString() + "원";

      const delBtn = document.createElement("button");
      delBtn.className = "del-btn";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        // 오터치로 바로 지워지지 않게 한 번 확인
        if (await askConfirm(`'${item.name}'을(를) 삭제할까요?`)) {
          deleteItem(item.id);
        }
      });

      li.addEventListener("click", () => openDetail(item.id));

      li.append(checkbox, badge, name);
      if (pendingTag) li.append(pendingTag);
      li.append(price, delBtn);
      ul.appendChild(li);
    });

    list.appendChild(ul);
  });

  // 합계는 "지금 보이는 항목" 기준. 필터 중이면 라벨로 표시해 줌
  const total = visible.reduce((sum, item) => sum + item.price * item.qty, 0);
  totalEl.textContent = total.toLocaleString() + "원";
  const base = view === "cart" ? "합계" : "총 구매액";
  totalLabel.textContent =
    filterCat === null && filterPri === null ? base : base + " (필터 적용)";

  // 하단 고정바(모바일)를 위쪽 버튼/합계와 동일하게 맞춤
  mbApply.hidden = applyBtn.hidden;
  mbApply.textContent = applyBtn.textContent;
  mbTotalVal.textContent = totalEl.textContent;
  mbTotalLabel.textContent = totalLabel.textContent;

  // 필터 버튼 배지 갱신
  updateFilterBadge();
}

// ===== 이벤트 =====
form.addEventListener("submit", (e) => {
  e.preventDefault();

  addItem({
    name: nameInput.value.trim(),
    price: Number(priceInput.value),
    qty: Number(qtyInput.value),
    done: false,
    cat: catSelect.value,
    priority: Number(priSelect.value),
  });

  hideSuggestions();
  nameInput.value = "";
  priceInput.value = "";
  qtyInput.value = 1;
  subSelect.value = "";
  nameInput.focus();
});

// 전체 비우기: 버튼 자체가 "전체 선택" 상태에서만 보이지만,
// 혹시 모를 상황(렌더 사이의 클릭)에 대비해 한 번 더 확인함
clearBtn.addEventListener("click", () => {
  if (!checkAll.checked || selected.size === 0) return;
  deleteSelected();
});

// 전체 선택: 지금 보이는(탭+필터 통과) 품목 전부를 선택/해제 (처리는 버튼이 함)
checkAll.addEventListener("change", () => {
  visibleItems().forEach((x) =>
    checkAll.checked ? selected.add(x.id) : selected.delete(x.id)
  );
  render();
});

// 구매 완료(장바구니) / 되돌리기(기록) 버튼: 선택된 항목을 한 번에 실제 처리
// (하단 고정바의 버튼과 같은 applySelected를 공유)
applyBtn.addEventListener("click", applySelected);

// 탭 전환 (탭을 바꾸면 선택도 초기화)
tabCart.addEventListener("click", () => {
  view = "cart";
  selected.clear();
  render();
});
tabHistory.addEventListener("click", () => {
  view = "history";
  selected.clear();
  render();
});

// 다른 기기에서 바꾼 내용 반영: 탭이 다시 보이면 새로 불러옴
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadItems();
});

// 연결 상태가 바뀔 때: 배너 갱신, 다시 연결되면
// 밀린 변경(큐)을 먼저 서버에 보내고 최신 목록을 받아옴 (loadItems가 알아서 함)
window.addEventListener("online", () => {
  updateOfflineBanner();
  loadItems();
});
window.addEventListener("offline", updateOfflineBanner);

// ===== 모바일: 필터 시트 =====
// 폰에서는 사이드바가 아래에서 올라오는 시트로 동작. 버튼으로 열고,
// 백드롭/완료 버튼으로 닫음. (데스크톱에선 버튼이 숨겨져 있어 항상 사이드바 그대로)
const sidebarEl = document.getElementById("sidebar");
const filterToggle = document.getElementById("filter-toggle");
const filterBadge = document.getElementById("filter-badge");
const sheetClose = document.getElementById("sheet-close");
const sheetBackdrop = document.getElementById("sheet-backdrop");

function openSheet() {
  sidebarEl.classList.add("open");
  sheetBackdrop.hidden = false;
}
function closeSheet() {
  sidebarEl.classList.remove("open");
  sheetBackdrop.hidden = true;
}
filterToggle.addEventListener("click", openSheet);
sheetClose.addEventListener("click", closeSheet);
sheetBackdrop.addEventListener("click", closeSheet);

// 필터 버튼 옆 배지: 지금 걸린 필터(분류/중요도)를 요약해 보여줌
function updateFilterBadge() {
  const parts = [];
  if (filterCat) parts.push(filterCat);
  if (filterPri) parts.push(priorityInfo(filterPri).label);
  if (parts.length) {
    filterBadge.textContent = parts.join(" · ");
    filterBadge.hidden = false;
  } else {
    filterBadge.hidden = true;
  }
}

// ===== 모바일: 하단 고정 액션바 =====
// 합계와 "구매 완료/되돌리기" 버튼을 화면 하단에 항상 띄움(긴 목록 대비).
// 내용은 render()가 위쪽 applyBtn/합계와 똑같이 맞춰 줌.
const mbApply = document.getElementById("mb-apply");
const mbTotalVal = document.getElementById("mb-total-val");
const mbTotalLabel = document.getElementById("mb-total-label");

// 선택한 항목을 실제 처리(구매완료/되돌리기) — 위/아래 두 버튼이 공유
function applySelected() {
  const ids = [...selected];
  selected.clear();
  bulkUpdate(ids, donePatch(view === "cart"));
}
mbApply.addEventListener("click", applySelected);

// ===== 삭제 확인 대화상자 =====
// 되돌리기가 없는 단일 삭제 전에 한 번 더 확인. Promise로 만들어
// `if (await askConfirm(...))` 처럼 자연스럽게 쓸 수 있게 함.
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
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}
confirmOk.addEventListener("click", () => settleConfirm(true));
confirmCancel.addEventListener("click", () => settleConfirm(false));
confirmBackdrop.addEventListener("click", (e) => {
  if (e.target === confirmBackdrop) settleConfirm(false);
});

// ===== 시작 =====
async function init() {
  fillSubOptions();

  // 1) 기기에 저장된 캐시 + 못 보낸 변경 큐를 불러와 먼저 그림
  //    → 인터넷 없어도, 느려도 목록이 바로 보임
  loadCache();
  loadQueue();
  render();
  updateOfflineBanner();

  // 2) 서비스 워커 등록 (앱 파일 캐시 담당. https 배포 주소에서만 동작)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // 3) 온라인이면 서버에서 최신 목록으로 갱신
  if (!isOffline()) {
    await migrateLocal(); // 예전 localStorage 데이터가 있으면 먼저 올리고
    await loadItems(); // DB에서 전체 목록 불러오기
  }
}
init();
