// ===== 데이터 =====
// item 구조: { name, price, qty, done, cat }  (cat = 대분류)
let items = JSON.parse(localStorage.getItem("cart-items")) || [];

// 예전 버전 데이터에는 cat이 없으므로 "기타"로 채워줌 (데이터 마이그레이션)
items.forEach((item) => {
  if (!item.cat) item.cat = "기타";
});

const form = document.getElementById("add-form");
const catSelect = document.getElementById("cat-select");
const subSelect = document.getElementById("sub-select");
const nameInput = document.getElementById("item-name");
const priceInput = document.getElementById("item-price");
const qtyInput = document.getElementById("item-qty");
const list = document.getElementById("item-list");
const totalEl = document.getElementById("total");
const clearBtn = document.getElementById("clear-btn");

// ===== 분류 select 채우기 =====
// CATEGORIES(data.js)의 key들로 대분류 옵션을 만듦
Object.keys(CATEGORIES).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  catSelect.appendChild(opt);
});

// 대분류가 바뀌면 소분류 옵션을 다시 채움
function fillSubOptions() {
  subSelect.innerHTML = "";

  // 맨 위에 "직접 입력" 옵션 (value가 빈 문자열이면 자동 입력 안 함)
  const manual = document.createElement("option");
  manual.value = "";
  manual.textContent = "직접 입력";
  subSelect.appendChild(manual);

  const subs = CATEGORIES[catSelect.value];
  Object.keys(subs).forEach((sub) => {
    const opt = document.createElement("option");
    opt.value = sub;
    // 소분류 이름 옆에 대략 가격도 같이 보여줌
    opt.textContent = `${sub} — 약 ${subs[sub].toLocaleString()}원`;
    subSelect.appendChild(opt);
  });
}

catSelect.addEventListener("change", fillSubOptions);

// 소분류를 고르면 품목명/가격을 자동 입력 (수정 가능)
subSelect.addEventListener("change", () => {
  const sub = subSelect.value;
  if (!sub) return; // "직접 입력"이면 그대로 둠
  nameInput.value = sub;
  priceInput.value = CATEGORIES[catSelect.value][sub];
  qtyInput.focus();
});

// ===== 네이버 쇼핑 추천 =====
const sugBox = document.getElementById("suggestions");

// 디바운스: 타자 칠 때마다 API를 부르면 낭비라서,
// 입력이 300ms 멈췄을 때 한 번만 호출하는 기법
let debounceTimer;
nameInput.addEventListener("input", () => {
  clearTimeout(debounceTimer); // 이전 예약 취소
  const q = nameInput.value.trim();
  if (q.length < 2) {
    hideSuggestions();
    return;
  }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
});

async function fetchSuggestions(q) {
  try {
    // 우리 서버리스 함수를 호출 (같은 도메인이라 CORS 문제 없음)
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    if (!res.ok) throw new Error("api error");
    const data = await res.json();
    // 응답이 왔을 때 입력값이 이미 바뀌었으면 무시 (오래된 결과 방지)
    if (nameInput.value.trim() !== q) return;
    renderSuggestions(data.items);
  } catch {
    hideSuggestions(); // 실패하면 조용히 숨김 (직접 입력은 계속 가능)
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

// 추천 목록 바깥을 클릭하면 닫기
document.addEventListener("click", (e) => {
  if (!sugBox.contains(e.target) && e.target !== nameInput) {
    hideSuggestions();
  }
});

// ===== 상세/수정 모달 =====
const backdrop = document.getElementById("modal-backdrop");
const editCat = document.getElementById("edit-cat");
const editName = document.getElementById("edit-name");
const editPrice = document.getElementById("edit-price");
const editQty = document.getElementById("edit-qty");
const editSugs = document.getElementById("edit-sugs");
const editSave = document.getElementById("edit-save");
const editCancel = document.getElementById("edit-cancel");
const editDelete = document.getElementById("edit-delete");

let editingIndex = null; // 지금 수정 중인 항목이 items의 몇 번째인지

// 모달의 분류 select도 추가 폼과 똑같이 채움
Object.keys(CATEGORIES).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  editCat.appendChild(opt);
});

function openDetail(index) {
  editingIndex = index;
  const item = items[index];
  // 현재 값으로 입력칸 채우기
  editCat.value = item.cat;
  editName.value = item.name;
  editPrice.value = item.price;
  editQty.value = item.qty;
  backdrop.hidden = false;
  // 이 품목명으로 네이버 추천 5개 불러오기
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
    // 수정 화면에서는 이미 품목명이 있으므로 가격만 반영
    div.addEventListener("click", () => {
      editPrice.value = s.lprice;
    });
    editSugs.appendChild(div);
  });
}

// 모달에서 품목명을 고치면 잠시 후 추천도 새로 검색
let editDebounce;
editName.addEventListener("input", () => {
  clearTimeout(editDebounce);
  const q = editName.value.trim();
  if (q.length < 2) return;
  editDebounce = setTimeout(() => loadEditSuggestions(q), 400);
});

function closeDetail() {
  backdrop.hidden = true;
  editingIndex = null;
}

editSave.addEventListener("click", () => {
  if (editingIndex === null) return;
  const name = editName.value.trim();
  if (!name) return editName.focus(); // 이름이 비면 저장 안 함

  items[editingIndex] = {
    ...items[editingIndex], // done 같은 나머지 값은 그대로 유지 (전개 구문)
    cat: editCat.value,
    name,
    price: Number(editPrice.value) || 0,
    qty: Math.max(1, Number(editQty.value) || 1),
  };
  save();
  render();
  closeDetail();
});

editDelete.addEventListener("click", () => {
  if (editingIndex === null) return;
  items.splice(editingIndex, 1);
  save();
  render();
  closeDetail();
});

editCancel.addEventListener("click", closeDetail);

// 모달 바깥(어두운 배경)을 클릭하면 닫기
backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) closeDetail();
});

// ===== 저장 =====
function save() {
  localStorage.setItem("cart-items", JSON.stringify(items));
}

// ===== 화면 그리기 =====
function render() {
  list.innerHTML = "";

  // 대분류별로 묶어서 표시. CATEGORIES의 순서를 그대로 사용
  Object.keys(CATEGORIES).forEach((cat) => {
    // 이 분류에 속한 항목만 골라냄 (원래 배열의 index를 같이 기억)
    const group = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.cat === cat);

    if (group.length === 0) return; // 비어 있는 분류는 표시 안 함

    // 분류 제목 + 분류 소계
    const heading = document.createElement("div");
    heading.className = "group-heading";
    const subtotal = group.reduce(
      (sum, { item }) => sum + item.price * item.qty,
      0
    );
    heading.innerHTML = `<span>${cat}</span><span>${subtotal.toLocaleString()}원</span>`;
    list.appendChild(heading);

    const ul = document.createElement("ul");

    group.forEach(({ item, index }) => {
      const li = document.createElement("li");
      if (item.done) li.classList.add("done");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      // stopPropagation: 클릭이 li까지 전달(버블링)되면 모달이 같이 열려버림
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        items[index].done = checkbox.checked;
        save();
        render();
      });

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
        e.stopPropagation(); // li 클릭(모달 열기)과 겹치지 않게
        items.splice(index, 1);
        save();
        render();
      });

      // 줄 아무 데나 클릭하면 상세/수정 모달 열기
      li.addEventListener("click", () => openDetail(index));

      li.append(checkbox, name, price, delBtn);
      ul.appendChild(li);
    });

    list.appendChild(ul);
  });

  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  totalEl.textContent = total.toLocaleString() + "원";
}

// ===== 이벤트 =====
form.addEventListener("submit", (e) => {
  e.preventDefault();

  items.push({
    name: nameInput.value.trim(),
    price: Number(priceInput.value),
    qty: Number(qtyInput.value),
    done: false,
    cat: catSelect.value, // 어느 대분류에서 추가했는지 기억
  });

  save();
  render();
  // 분류 선택은 유지하고 입력칸만 비움 (같은 분류에서 연속 추가가 편함)
  nameInput.value = "";
  priceInput.value = "";
  qtyInput.value = 1;
  subSelect.value = "";
  nameInput.focus();
});

clearBtn.addEventListener("click", () => {
  if (items.length === 0) return;
  items = [];
  save();
  render();
});

// 처음 열릴 때: 소분류 채우고 화면 그리기
fillSubOptions();
render();
