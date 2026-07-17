// ===== Supabase 연결 =====
// createClient(주소, 공개키): 이 키(publishable)는 브라우저에 노출돼도 되는 키.
// 실제 권한은 DB의 RLS 정책이 결정함.
const SUPABASE_URL = "https://czkdfopmbfdlxtegwgav.supabase.co";
const SUPABASE_KEY = "sb_publishable_YTFDp9WweP3alI-71yE4rg_UMbpQFMS";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 상태 =====
// item 구조: { id, name, price, qty, done, cat, priority, created_at }
// id는 DB가 만들어 주는 고유값. 이제 배열 index 대신 id로 항목을 찾음.
let items = [];
let filterCat = null; // null이면 전체
let filterPri = null; // null이면 전체

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

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
  setTimeout(() => (errorBanner.hidden = true), 4000);
}

// ===== DB 함수 =====
// async/await: DB 요청은 시간이 걸리므로 응답을 기다렸다가 다음 줄을 실행

async function loadItems() {
  const { data, error } = await sb
    .from("cart_items")
    .select("*")
    .order("created_at"); // 추가한 순서대로
  if (error) return showError("목록을 불러오지 못했어요");
  items = data;
  render();
}

async function addItem(fields) {
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
  const { data, error } = await sb
    .from("cart_items")
    .update(patch)
    .eq("id", id) // id가 일치하는 행만
    .select()
    .single();
  if (error) return showError("수정에 실패했어요");
  const i = items.findIndex((x) => x.id === id);
  if (i !== -1) items[i] = data;
  render();
}

async function deleteItem(id) {
  const { error } = await sb.from("cart_items").delete().eq("id", id);
  if (error) return showError("삭제에 실패했어요");
  items = items.filter((x) => x.id !== id);
  render();
}

async function clearAll() {
  // delete는 실수 방지를 위해 조건이 필수라서 "id가 null이 아닌 행" = 전부
  const { error } = await sb.from("cart_items").delete().not("id", "is", null);
  if (error) return showError("비우기에 실패했어요");
  items = [];
  render();
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

  // "전체" 버튼 (필터 해제)
  sideCats.appendChild(
    makeSideButton({
      label: "전체",
      count: items.length,
      isActive: filterCat === null,
      onClick: () => {
        filterCat = null;
        render();
      },
    })
  );

  Object.keys(CATEGORIES).forEach((cat) => {
    const count = items.filter((x) => x.cat === cat).length;
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
    const count = items.filter((x) => x.priority === p.value).length;
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
      nameInput.value = s.title;
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

editDelete.addEventListener("click", () => {
  if (editingId === null) return;
  deleteItem(editingId);
  closeDetail();
});

editCancel.addEventListener("click", closeDetail);

backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) closeDetail();
});

// ===== 화면 그리기 =====
function render() {
  renderSidebar();
  list.innerHTML = "";

  // 현재 필터에 맞는 항목만 (분류 필터와 중요도 필터는 동시에 적용 가능)
  const visible = items.filter(
    (x) =>
      (filterCat === null || x.cat === filterCat) &&
      (filterPri === null || x.priority === filterPri)
  );

  if (visible.length === 0 && items.length > 0) {
    list.innerHTML = '<p class="loading">이 필터에 해당하는 품목이 없어요</p>';
  }

  Object.keys(CATEGORIES).forEach((cat) => {
    const group = visible.filter((item) => item.cat === cat);
    if (group.length === 0) return;

    const heading = document.createElement("div");
    heading.className = "group-heading";
    const subtotal = group.reduce((sum, item) => sum + item.price * item.qty, 0);
    heading.innerHTML = `<span>${cat}</span><span>${subtotal.toLocaleString()}원</span>`;
    list.appendChild(heading);

    const ul = document.createElement("ul");

    group.forEach((item) => {
      const li = document.createElement("li");
      if (item.done) li.classList.add("done");

      // 드래그 시작: 이 항목의 id를 실어 보냄 → 사이드바 drop에서 꺼내 씀
      li.draggable = true;
      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", item.id);
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        updateItem(item.id, { done: checkbox.checked });
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

      const price = document.createElement("span");
      price.className = "price";
      price.textContent = (item.price * item.qty).toLocaleString() + "원";

      const delBtn = document.createElement("button");
      delBtn.className = "del-btn";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });

      li.addEventListener("click", () => openDetail(item.id));

      li.append(checkbox, badge, name, price, delBtn);
      ul.appendChild(li);
    });

    list.appendChild(ul);
  });

  // 합계는 "지금 보이는 항목" 기준. 필터 중이면 라벨로 표시해 줌
  const total = visible.reduce((sum, item) => sum + item.price * item.qty, 0);
  totalEl.textContent = total.toLocaleString() + "원";
  totalLabel.textContent =
    filterCat === null && filterPri === null ? "합계" : "합계 (필터 적용)";
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

clearBtn.addEventListener("click", () => {
  if (items.length === 0) return;
  clearAll();
});

// 다른 기기에서 바꾼 내용 반영: 탭이 다시 보이면 새로 불러옴
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadItems();
});

// ===== 시작 =====
async function init() {
  fillSubOptions();
  renderSidebar();
  await migrateLocal(); // 예전 localStorage 데이터가 있으면 먼저 올리고
  await loadItems(); // DB에서 전체 목록 불러오기
}
init();
