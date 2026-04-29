export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const { image, mediaType } = req.body;
    if(!image) return res.status(400).json({error:'No image'});

    const CLOVA_URL = process.env.CLOVA_OCR_URL;
    const CLOVA_KEY = process.env.CLOVA_OCR_KEY;

    if(!CLOVA_URL || !CLOVA_KEY) {
      return res.status(500).json({error:'OCR not configured - check CLOVA_OCR_URL and CLOVA_OCR_KEY env vars'});
    }

    // http → https 강제 변환 (Vercel 요구사항)
    const url = CLOVA_URL.replace(/^http:\/\//, 'https://');

    const fmt = ((mediaType||'image/jpeg').split('/')[1]||'jpeg').replace('jpg','jpeg');
    const body = JSON.stringify({
      version: 'V2',
      requestId: String(Date.now()),
      timestamp: Date.now(),
      images: [{ format: fmt, name: 'book', data: image }]
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OCR-SECRET': CLOVA_KEY
      },
      body
    });

    if(!resp.ok) {
      const errText = await resp.text();
      return res.status(500).json({error: `Clova OCR error ${resp.status}: ${errText}`});
    }

    const data = await resp.json();
    // 줄바꿈 구조 보존: lineBreak 기준으로 텍스트 합치기
    const fields = data.images?.[0]?.fields || [];
    let text = '';
    for(let i = 0; i < fields.length; i++) {
      text += fields[i].inferText;
      if(fields[i].lineBreak) text += '\n';
      else if(i < fields.length - 1) text += ' ';
    }

    return res.status(200).json({text: text.trim()});
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
