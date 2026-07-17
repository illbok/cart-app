// 네이버 쇼핑 검색 프록시 (서버리스 함수)
// 브라우저에서 직접 네이버 API를 부르면 키가 노출되고 CORS에 막히므로,
// 우리 서버(이 함수)가 대신 호출해서 결과만 넘겨줌.

// 같은 검색어는 1시간 동안 캐시 (서버 인스턴스가 살아있는 동안)
const cache = new Map();
const CACHE_MS = 60 * 60 * 1000;

export default async function handler(req, res) {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q(검색어)가 필요합니다" });

  // 키는 코드에 적지 않고 Vercel 환경변수에서만 읽음 (보안)
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(500).json({
      error:
        "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정에서 등록하세요.",
    });
  }

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) {
    return res.status(200).json({ items: hit.items, cached: true });
  }

  const url =
    "https://openapi.naver.com/v1/search/shop.json?display=5&query=" +
    encodeURIComponent(q);

  const r = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": id,
      "X-Naver-Client-Secret": secret,
    },
  });

  if (!r.ok) {
    return res.status(r.status).json({ error: "네이버 API 오류" });
  }

  const data = await r.json();
  // 필요한 것만 추려서 반환. title에 섞여 오는 <b> 태그는 제거
  const items = (data.items || []).map((i) => ({
    title: i.title.replace(/<[^>]*>/g, ""),
    lprice: Number(i.lprice),
  }));

  cache.set(key, { time: Date.now(), items });
  res.status(200).json({ items });
}
