const https = require('https');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body || {};
    if (!image) return res.status(400).json({ error: 'No image' });

    const CLOVA_KEY = 'cGhUd05xUFdkYnN2aEV1SlVwSmdIWHhWY1RSUE5MZk4=';
    const bodyStr = JSON.stringify({
      version: 'V2',
      requestId: String(Date.now()),
      timestamp: Date.now(),
      images: [{ format: 'jpeg', name: 'book', data: image }]
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'icnzm1omhq.apigw.ntruss.com',
        port: 443,
        path: '/custom/v1/52384/c90697f1e4289b9dae370b75bd5d60025d5ac2ae2065872d14b08409db3d25d0/general',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OCR-SECRET': CLOVA_KEY,
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      };
      const req2 = https.request(options, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve({ status: r.statusCode, body: data }));
      });
      req2.on('error', reject);
      req2.write(bodyStr);
      req2.end();
    });

    if (result.status !== 200) {
      return res.status(500).json({ error: `Clova ${result.status}: ${result.body.slice(0,200)}` });
    }

    const data = JSON.parse(result.body);
    const fields = data.images?.[0]?.fields || [];
    let text = '';
    for (let i = 0; i < fields.length; i++) {
      text += fields[i].inferText;
      if (fields[i].lineBreak) text += '\n';
      else if (i < fields.length - 1) text += ' ';
    }
    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
