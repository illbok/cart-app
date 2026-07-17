# 🛒 장바구니 (cart-app)

장보기 목록을 관리하는 웹앱. 첫 웹 개발 프로젝트.

**배포 주소**: https://cart-app-livid-eta.vercel.app

## 기능

- 품목/가격/수량 추가, 구매 완료 체크, 삭제, 합계 자동 계산
- 대분류 → 소분류 선택 시 품목명·평균 가격 자동 입력 (내장 가격표 42종)
- 품목 입력 시 네이버 쇼핑 최저가 추천 5개 (서버리스 함수 프록시)
- 품목 클릭 → 상세 모달에서 분류/품목명/가격/수량 수정 + 추천 가격 반영
- localStorage로 데이터 유지 (새로고침해도 목록 보존)

## 기술 스택

- 프론트엔드: 바닐라 HTML / CSS / JavaScript
- 백엔드: Vercel Serverless Function (`api/search.js`)
- 외부 API: 네이버 쇼핑 검색 API
- 배포: Vercel

## 파일 구조

```
index.html      화면 구조 (추가 폼, 목록, 상세 모달)
style.css       스타일
script.js       동작 로직 (데이터 → render 패턴)
data.js         분류/평균가격 데이터
api/search.js   네이버 쇼핑 검색 프록시 (서버리스)
```

## 환경변수 (Vercel > Settings > Environment Variables)

| 이름 | 설명 |
|------|------|
| `NAVER_CLIENT_ID` | 네이버 개발자센터 애플리케이션 Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 개발자센터 애플리케이션 Client Secret |

네이버 개발자센터 앱의 "사용 API"에 **검색**이 추가되어 있어야 함.
