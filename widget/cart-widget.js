// ============================================================
// cart-app 홈 위젯 (iOS / Scriptable)
// 장바구니(살 것)를 Supabase에서 읽어 바탕화면 위젯으로 표시.
// 사용법: Scriptable 앱에 이 스크립트를 새로 만들어 붙여넣기 →
//         홈에 Scriptable 위젯 추가 → 위젯 길게 눌러 "스크립트"를 이 이름으로 지정.
// ============================================================

// ---- 설정 ----
const SUPABASE_URL = "https://czkdfopmbfdlxtegwgav.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6a2Rmb3BtYmZkbHh0ZWd3Z2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNzQ5MDUsImV4cCI6MjA5OTg1MDkwNX0.ZDyVAD0NcuKV8_JNG5ipSZYh6yAj2maRJwaID6CT2uw";
const APP_URL = "https://cart-app-livid-eta.vercel.app";
const REFRESH_MIN = 15; // 다음 갱신 힌트(분). iOS가 실제 시점은 조절함.

// ---- 색상 (앱 인디고 테마) ----
const C = {
  bg1: new Color("#3730a3"),
  bg2: new Color("#4f46e5"),
  card: new Color("#ffffff"),
  sub: new Color("#c7d2fe"),
  text: new Color("#ffffff"),
  dim: new Color("#e0e7ff"),
  badgeBg: new Color("#ffffff"),
  badgeTx: new Color("#4f46e5"),
  done: new Color("#a5b4fc"),
};

function wonFmt(n) {
  return "₩" + Number(n || 0).toLocaleString("ko-KR");
}

async function fetchItems() {
  const q = "?select=name,qty,price,priority,cat&done=eq.false&order=priority.asc,created_at.asc";
  const req = new Request(SUPABASE_URL + "/rest/v1/cart_items" + q);
  req.headers = { apikey: ANON, Authorization: "Bearer " + ANON };
  req.timeoutInterval = 12;
  const rows = await req.loadJSON();
  return Array.isArray(rows) ? rows : [];
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function build() {
  const family = config.widgetFamily || "medium";
  const w = new ListWidget();
  w.url = APP_URL; // 탭하면 앱 열기
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);

  // 배경 그라디언트
  const g = new LinearGradient();
  g.colors = [C.bg1, C.bg2];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 15, 14, 15);

  let items = [];
  let ok = true;
  try {
    items = await fetchItems();
  } catch (e) {
    ok = false;
  }

  const count = items.length;
  const total = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);

  // ---- 헤더 ----
  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText("🛒 장바구니");
  title.font = Font.boldSystemFont(14);
  title.textColor = C.text;
  head.addSpacer();
  // 개수 배지
  const badge = head.addStack();
  badge.backgroundColor = C.badgeBg;
  badge.cornerRadius = 9;
  badge.setPadding(2, 8, 2, 8);
  const bt = badge.addText(ok ? String(count) : "!");
  bt.font = Font.boldSystemFont(13);
  bt.textColor = C.badgeTx;

  w.addSpacer(8);

  if (!ok) {
    const e = w.addText("불러오기 실패 · 네트워크 확인");
    e.font = Font.systemFont(12);
    e.textColor = C.dim;
    w.addSpacer();
    return w;
  }

  if (count === 0) {
    const done = w.addText("살 것 없음 ✓");
    done.font = Font.semiboldSystemFont(15);
    done.textColor = C.text;
    w.addSpacer();
    const f = w.addText("탭하면 앱 열기");
    f.font = Font.systemFont(10);
    f.textColor = C.sub;
    return w;
  }

  // ---- 목록 (small은 개수/합계만) ----
  if (family !== "small") {
    const maxRows = family === "large" ? 8 : 4;
    const show = items.slice(0, maxRows);
    for (const it of show) {
      const row = w.addStack();
      row.centerAlignContent();
      const dot = row.addText("•");
      dot.font = Font.systemFont(12);
      dot.textColor = C.sub;
      row.addSpacer(6);
      const nm = row.addText(truncate(it.name, family === "large" ? 22 : 16));
      nm.font = Font.systemFont(12);
      nm.textColor = C.text;
      nm.lineLimit = 1;
      if ((it.qty || 1) > 1) {
        row.addSpacer(4);
        const q = row.addText("×" + it.qty);
        q.font = Font.mediumSystemFont(12);
        q.textColor = C.dim;
      }
      row.addSpacer();
      w.addSpacer(3);
    }
    const more = count - show.length;
    if (more > 0) {
      const m = w.addText("＋" + more + "개 더");
      m.font = Font.systemFont(11);
      m.textColor = C.sub;
    }
  }

  w.addSpacer();

  // ---- 하단: 합계 ----
  const foot = w.addStack();
  foot.centerAlignContent();
  const fl = foot.addText("예상 합계");
  fl.font = Font.systemFont(10);
  fl.textColor = C.sub;
  foot.addSpacer();
  const fr = foot.addText(wonFmt(total));
  fr.font = Font.boldSystemFont(13);
  fr.textColor = C.text;

  return w;
}

const widget = await build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // 앱에서 직접 실행 시 미리보기
  await widget.presentMedium();
}
Script.complete();
