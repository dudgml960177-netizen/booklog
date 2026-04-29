export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const CLOVA_URL = process.env.CLOVA_OCR_URL;
  const CLOVA_KEY = process.env.CLOVA_OCR_KEY;

  if (!CLOVA_URL || !CLOVA_KEY) {
    return new Response(
      JSON.stringify({ error: 'OCR not configured', hasUrl: !!CLOVA_URL, hasKey: !!CLOVA_KEY }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const { image } = body;
    if (!image) {
      return new Response(JSON.stringify({ error: 'No image' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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

    if (!clovaResp.ok) {
      const errText = await clovaResp.text();
      return new Response(JSON.stringify({ error: `Clova ${clovaResp.status}: ${errText.slice(0,300)}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await clovaResp.json();
    const fields = data.images?.[0]?.fields || [];

    let text = '';
    for (let i = 0; i < fields.length; i++) {
      text += fields[i].inferText;
      if (fields[i].lineBreak) text += '\n';
      else if (i < fields.length - 1) text += ' ';
    }

    return new Response(JSON.stringify({ text: text.trim() }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
