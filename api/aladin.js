// 알라딘 Open API 프록시
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 환경변수 우선, 없으면 발급받은 키 사용
  const TTB_KEY = process.env.ALADIN_TTB_KEY || 'ttbk_tenten1721001';

  const { query, isbn, target } = req.query;
  const searchTarget = target === 'eBook' ? 'eBook' : 'Book';
  let url;

  if (isbn) {
    url = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${TTB_KEY}` +
      `&itemIdType=ISBN13&ItemId=${encodeURIComponent(isbn)}` +
      `&output=js&Version=20131101&OptResult=subInfo&Cover=Big`;
  } else if (query) {
    url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${TTB_KEY}` +
      `&Query=${encodeURIComponent(query)}&QueryType=Keyword` +
      `&MaxResults=50&start=1&SearchTarget=${searchTarget}` +
      `&output=js&Version=20131101&OptResult=subInfo&Cover=Big`;
  } else {
    return res.status(400).json({ errorCode: 400, errorMessage: 'query 또는 isbn 파라미터 필요' });
  }

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'booklog/1.0' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const data = JSON.parse(text.replace(/^﻿/, ''));
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ errorCode: 500, errorMessage: e.message });
  }
}
