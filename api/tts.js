const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { VoiceLab } = require('@voicelab/sdk');

const DEFAULT_KEY = 'vlk_KXxN2j-01fkHVKk48qvGcZ9RkWW0n0UfrRLHcARyPD0';

function getVoiceLabKey() {
  return process.env.VOICELAB_API_KEY || DEFAULT_KEY;
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (e) {}
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function generateEdgeAudioBuffer(text, voiceCode) {
  const tts = new MsEdgeTTS();
  const voice = (voiceCode === 'sardor' || voiceCode === 'uz-UZ-SardorNeural')
    ? 'uz-UZ-SardorNeural'
    : 'uz-UZ-MadinaNeural';

  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const body = await parseBody(req);
    const text = (body.text || '').trim();
    let voice = body.voice || 'madina';

    if (!text) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ success: false, error: "Matn kiritilmadi" }));
    }

    // 1. Agar foydalanuvchi VoiceLab ovozini tanlagan bo'lsa
    if (voice.startsWith('voice_')) {
      const apiKey = getVoiceLabKey();
      if (apiKey) {
        try {
          const client = new VoiceLab({ apiKey });
          const vlRes = await client.tts.synthesize({
            text: text,
            language: 'uz',
            voiceId: voice
          });
          const base64 = Buffer.from(vlRes.audio).toString('base64');
          res.statusCode = 200;
          return res.end(JSON.stringify({
            success: true,
            audioUrl: `data:audio/mp3;base64,${base64}`,
            engine: 'voicelab',
            voice: voice,
            text: text
          }));
        } catch (vlErr) {
          console.warn('VoiceLab xatosi, bepul Madina ovoziga o\'tkazilmoqda:', vlErr.message);
          // 402 bo'lsa, to'xtamasdan bepul Madina ovoziga o'tish
          try {
            const fbBuffer = await generateEdgeAudioBuffer(text, 'madina');
            const dataUri = `data:audio/mp3;base64,${fbBuffer.toString('base64')}`;
            res.statusCode = 200;
            return res.end(JSON.stringify({
              success: true,
              audioUrl: dataUri,
              engine: 'edge_fallback',
              voice: 'madina',
              isFallback: true,
              note: "VoiceLab hisobingizda limit tugagan (402). E'lon avtomatik ravishda bepul 'Madina' ovozida yaratildi!",
              text: text
            }));
          } catch (fbErr) {
            res.statusCode = 500;
            return res.end(JSON.stringify({
              success: false,
              error: `Ovoz yaratishda xatolik: ${fbErr.message}`
            }));
          }
        }
      }
    }

    // 2. Microsoft Edge Neural (Madina / Sardor — 100% Bepul va Cheksiz)
    try {
      const buffer = await generateEdgeAudioBuffer(text, voice);
      const dataUri = `data:audio/mp3;base64,${buffer.toString('base64')}`;

      res.statusCode = 200;
      return res.end(JSON.stringify({
        success: true,
        audioUrl: dataUri,
        engine: 'edge',
        voice: voice,
        text: text
      }));
    } catch (edgeErr) {
      res.statusCode = 500;
      return res.end(JSON.stringify({
        success: false,
        error: `Edge TTS xatoligi: ${edgeErr.message}`
      }));
    }
  } catch (err) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ success: false, error: err.message }));
  }
};
