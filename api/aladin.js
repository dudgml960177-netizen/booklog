// 알라딘 Open API 프록시
// Vercel 환경 변수: ALADIN_TTB_KEY (알라딘 개발자 TTB 키)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TTB_KEY = process.env.ALADIN_TTB_KEY;
  if (!TTB_KEY) {
    return res.status(503).json({ errorCode: 503, errorMessage: 'Aladin API key not configured' });
  }

  const { query, isbn } = req.query;
  let url;

  if (isbn) {
    // ISBN으로 상세 조회 — subInfo.itemPage 포함
    url = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${TTB_KEY}` +
      `&itemIdType=ISBN13&ItemId=${encodeURIComponent(isbn)}` +
      `&output=js&Version=20131101&OptResult=subInfo&Cover=Big`;
  } else if (query) {
    // 제목/저자 키워드 검색
    url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${TTB_KEY}` +
      `&Query=${encodeURIComponent(query)}&QueryType=Keyword` +
      `&MaxResults=50&start=1&SearchTarget=Book` +
      `&output=js&Version=20131101&OptResult=subInfo&Cover=Big`;
  } else {
    return res.status(400).json({ errorCode: 400, errorMessage: 'query 또는 isbn 파라미터 필요' });
  }

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'booklog/1.0' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    // BOM(﻿) 제거 후 JSON 파싱
    const data = JSON.parse(text.replace(/^﻿/, ''));
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ errorCode: 500, errorMessage: e.message });
  }
}
