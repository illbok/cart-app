# 장바구니 앱 (cart-app)

바닐라 HTML/CSS/JS + Vercel 서버리스 함수 + Supabase로 만든 장바구니 웹앱.

배포 주소: https://cart-app-livid-eta.vercel.app

## 기능 (v6)
- 품목 추가/수정/삭제, 구매 완료 체크, 분류별 그룹 + 소계
- 대분류 5개 → 소분류 42개 자동 입력
- 네이버 쇼핑 최저가 추천 (입력 디바운스, 서버 캐시 1시간)
- 상세/수정 모달
- **Supabase 저장** — 기기 간 동기화 (로그인 없는 공유 리스트)
- **쇼핑 중요도 5단계** — Must Buy / High / Normal / Low / Wish List
- **사이드바** — 분류·중요도 필터 + PC에서 드래그로 분류/중요도 변경
- 기존 localStorage 데이터는 첫 접속 때 자동으로 Supabase로 이전됨

## 구조
- `index.html` / `style.css` / `data.js`(분류·가격·중요도 데이터) / `script.js`(로직)
- `api/search.js` — 네이버 쇼핑 API 프록시 (서버리스 함수)

## 환경변수 (Vercel 프로젝트 설정에 등록)
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

Supabase URL/publishable key는 브라우저 노출이 허용되는 값이라 script.js에 직접 적음.
실제 권한은 DB의 RLS 정책으로 관리.
