export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const { image } = req.body;
    if(!image) return res.status(400).json({error:'No image'});
    const key = process.env.GOOGLE_VISION_KEY;
    if(!key) return res.status(500).json({error:'API key not set'});
    const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{image:{content:image},features:[{type:'DOCUMENT_TEXT_DETECTION'}]}]})
    });
    const data = await resp.json();
    if(data.error) return res.status(500).json({error:data.error.message});
    const text = data.responses?.[0]?.fullTextAnnotation?.text||'';
    return res.status(200).json({text});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
}
