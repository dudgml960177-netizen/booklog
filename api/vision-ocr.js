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

    if(!CLOVA_URL || !CLOVA_KEY) return res.status(500).json({error:'OCR not configured'});

    const body = JSON.stringify({
      version: 'V2',
      requestId: Date.now().toString(),
      timestamp: Date.now(),
      images: [{
        format: (mediaType||'image/jpeg').split('/')[1]||'jpeg',
        name: 'book',
        data: image
      }]
    });

    const resp = await fetch(CLOVA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OCR-SECRET': CLOVA_KEY
      },
      body
    });

    const data = await resp.json();
    if(!resp.ok) return res.status(500).json({error: JSON.stringify(data)});

    // 텍스트 추출
    const text = (data.images?.[0]?.fields||[])
      .map(f => f.inferText)
      .join(' ')
      .trim();

    return res.status(200).json({text});
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
