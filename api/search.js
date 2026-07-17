// ===== Vercel 서버리스 함수: /api/search?q=검색어 =====
// api 폴더의 파일은 Vercel이 자동으로 백엔드 함수로 만들어줌.
// 브라우저 → 이 함수 → 네이버 API 순서로 호출 (프록시).
// 이렇게 하면 CORS 문제가 없고, API 키가 브라우저에 노출되지 않음.

// 키는 코드에 적지 않고 환경변수에서만 읽음.
// (Vercel 대시보드 > 프로젝트 > Settings > Environment Variables에서 설정)
// 이렇게 해야 코드를 GitHub에 공개해도 키가 노출되지 않음.
const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

module.exports = async function handler(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({
      error: "서버에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다",
    });
  }

  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "검색어(q)가 필요합니다" });
  }

  // display=5: 5개만, sort=sim: 연관도순
  const url =
    "https://openapi.naver.com/v1/search/shop.json?display=5&sort=sim&query=" +
    encodeURIComponent(q);

  const naverRes = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": CLIENT_ID,
      "X-Naver-Client-Secret": CLIENT_SECRET,
    },
  });

  if (!naverRes.ok) {
    // 자세한 내용은 서버 로그에만 남기고, 브라우저에는 간단히 알림
    console.error("네이버 API 오류:", naverRes.status, await naverRes.text());
    return res.status(502).json({ error: "네이버 API 호출 실패" });
  }

  const data = await naverRes.json();

  // 필요한 필드만 골라서 정리 (title에는 <b>태그가 섞여 있어서 제거)
  const items = (data.items || []).map((it) => ({
    title: it.title.replace(/<[^>]*>/g, ""),
    lprice: Number(it.lprice), // 최저가
    mall: it.mallName,
  }));

  // 같은 검색어 결과를 Vercel이 1시간 캐시 → 네이버 호출 횟수 절약
  res.setHeader("Cache-Control", "s-maxage=3600");
  res.status(200).json({ items });
};
