# cart-app 홈 화면 위젯 (별도 클라이언트)

폰 바탕화면에서 "살 것"을 보여주는 위젯. **웹앱과 별개 클라이언트**로, 이 저장소의 코드나 DB를
바꾸지 않고 Supabase REST로 `cart_items`를 직접 읽는다. (RLS: anon 전체 허용)

## 데이터 계약
```
GET https://czkdfopmbfdlxtegwgav.supabase.co/rest/v1/cart_items
    ?select=name,qty,price,priority,cat&done=eq.false&order=priority.asc,created_at.asc
헤더: apikey: <anon>, Authorization: Bearer <anon>
```
- 표시: 살 것 개수 + 중요도순 상위 N개(이름 ×수량) + 예상 합계(Σ price×qty).
- 탭 → https://cart-app-livid-eta.vercel.app 열기.

## 구성
- `cart-widget.js` — iOS(Scriptable) 위젯. Scriptable 앱에 붙여넣고 홈에 위젯 추가.
- Android(네이티브 Kotlin AppWidget) — 별도 프로젝트로 관리(웹 저장소에 넣지 않음).
  권장: 별도 repo(예: illbok/cart-widget-android) 또는 로컬 별도 폴더. Android Studio로 빌드·설치.

## 주의
- **비실시간**: iOS는 시스템 주기, Android는 updatePeriodMillis(최소 30분)+수동 새로고침. 즉시 반영 아님.
- **보안**: anon 키 + 전체허용 RLS라, 위젯 소스를 남에게 주면 읽기뿐 아니라 쓰기·삭제도 가능.
  개인용 한정. 강화하려면 (a) 읽기전용 RLS 정책 분리, 또는 (b) 이 저장소 `api/`에 요약 전용
  `api/widget.js`(+비밀 토큰) 엔드포인트를 만들어 위젯이 그걸 읽게.
