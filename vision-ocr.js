export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLOVA_URL = process.env.CLOVA_OCR_URL;
  const CLOVA_KEY = process.env.CLOVA_OCR_KEY;

  if (!CLOVA_URL || !CLOVA_KEY) {
    return res.status(500).json({ 
      error: 'OCR not configured',
      debug: { hasUrl: !!CLOVA_URL, hasKey: !!CLOVA_KEY }
    });
  }

  try {
    const { image } = req.body || {};
    if (!image) return res.status(400).json({ error: 'No image data' });

    const url = CLOVA_URL.replace(/^http:\/\//, 'https://');
    
    const clovaResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OCR-SECRET': CLOVA_KEY,
      },
      body: JSON.stringify({
        version: 'V2',
        requestId: String(Date.now()),
        timestamp: Date.now(),
        images: [{ format: 'jpeg', name: 'book', data: image }]
      }),
    });

    const rawText = await clovaResp.text();
    
    if (!clovaResp.ok) {
      return res.status(500).json({ error: `Clova ${clovaResp.status}: ${rawText.slice(0, 200)}` });
    }

    const data = JSON.parse(rawText);
    const fields = data.images?.[0]?.fields || [];
    
    let text = '';
    for (let i = 0; i < fields.length; i++) {
      text += fields[i].inferText;
      if (fields[i].lineBreak) text += '\n';
      else if (i < fields.length - 1) text += ' ';
    }

    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 300) });
  }
}
