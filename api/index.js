const { VoiceLab } = require('@voicelab/sdk');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const DEFAULT_VOICELAB_KEY = 'vlk_KXxN2j-01fkHVKk48qvGcZ9RkWW0n0UfrRLHcARyPD0';

function getVoiceLabKey() {
  return process.env.VOICELAB_API_KEY || DEFAULT_VOICELAB_KEY;
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJsonResponse(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.end(JSON.stringify(data));
}

let cachedVoiceLabVoices = null;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    return res.end();
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. GET /api/voices
  if (pathname === '/api/voices' || pathname.endsWith('/voices')) {
    const key = getVoiceLabKey();
    let vlVoices = [];
    if (cachedVoiceLabVoices) {
      vlVoices = cachedVoiceLabVoices;
    } else if (key) {
      try {
        const client = new VoiceLab({ apiKey: key });
        const vlRes = await client.voices.list({ language: 'uz' });
        cachedVoiceLabVoices = (vlRes.data || []).map(v => ({
          id: v.id,
          name: `${v.displayName || 'Ovoz'} (${v.shortDescription || 'VoiceLab'})`,
          engine: 'voicelab',
          gender: v.gender || 'neutral',
          language: v.language || 'uz'
        }));
        vlVoices = cachedVoiceLabVoices;
      } catch (e) {
        console.error('Error fetching VoiceLab voices:', e.message);
      }
    }

    return sendJsonResponse(res, 200, {
      success: true,
      hasVoiceLabKey: !!key,
      voices: [
        { id: 'madina', name: "Madina (O'zbekcha ayol) — 100% Bepul", engine: 'edge', gender: 'female', default: false },
        { id: 'sardor', name: "Sardor (O'zbekcha erkak) — 100% Bepul", engine: 'edge', gender: 'male', default: false },
        ...vlVoices
      ]
    });
  }

  // 2. POST /api/tts
  if (pathname === '/api/tts' || pathname.endsWith('/tts')) {
    try {
      const body = await parseJsonBody(req);
      const text = (body.text || '').trim();
      let voice = body.voice || 'voice_01J9NEUTRAL0000000000000001';

      if (!text) {
        return sendJsonResponse(res, 400, { success: false, error: 'Matn (text) kiritilmagan' });
      }

      // VoiceLab synthesis
      if (voice.startsWith('voice_') || !voice || voice === 'voicelab') {
        const key = getVoiceLabKey();
        if (key) {
          try {
            const client = new VoiceLab({ apiKey: key });
            const cleanVoiceId = voice.startsWith('voice_') ? voice : 'voice_01J9NEUTRAL0000000000000001';
            const vlRes = await client.tts.synthesize({
              text: text,
              language: 'uz',
              voiceId: cleanVoiceId
            });
            const base64 = Buffer.from(vlRes.audio).toString('base64');
            const dataUri = `data:audio/mp3;base64,${base64}`;
            return sendJsonResponse(res, 200, {
              success: true,
              audioUrl: dataUri,
              cached: false,
              engine: 'voicelab',
              voice: cleanVoiceId,
              text: text
            });
          } catch (vlErr) {
            console.error('VoiceLab synthesis error:', vlErr.message);
          }
        }
      }

      // Fallback: Edge Neural TTS
      try {
        const tts = new MsEdgeTTS();
        const edgeVoice = (voice === 'sardor') ? 'uz-UZ-SardorNeural' : 'uz-UZ-MadinaNeural';
        await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);
        const chunks = [];
        for await (const chunk of audioStream) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        const dataUri = `data:audio/mp3;base64,${fullBuffer.toString('base64')}`;

        return sendJsonResponse(res, 200, {
          success: true,
          audioUrl: dataUri,
          cached: false,
          engine: 'edge',
          voice: edgeVoice,
          text: text
        });
      } catch (edgeErr) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: `Audio yaratishda xatolik: ${edgeErr.message}`
        });
      }
    } catch (err) {
      return sendJsonResponse(res, 500, { success: false, error: err.message });
    }
  }

  // 3. Fallback
  return sendJsonResponse(res, 404, { success: false, error: 'Endpoint topilmadi' });
};
