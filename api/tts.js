const { VoiceLab } = require('@voicelab/sdk');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const DEFAULT_KEY = 'vlk_KXxN2j-01fkHVKk48qvGcZ9RkWW0n0UfrRLHcARyPD0';

function getVoiceLabKey() {
  return process.env.VOICELAB_API_KEY || DEFAULT_KEY;
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
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

module.exports = async (req, res) => {
  // Enable CORS
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
    let voice = body.voice || 'voice_01J9NEUTRAL0000000000000001';

    if (!text) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ success: false, error: "Matn kiritilmadi" }));
    }

    // 1. Try VoiceLab if requested or default
    if (voice.startsWith('voice_') || voice === 'voicelab' || !voice) {
      const apiKey = getVoiceLabKey();
      if (apiKey) {
        try {
          const client = new VoiceLab({ apiKey });
          const cleanVoiceId = voice.startsWith('voice_') ? voice : 'voice_01J9NEUTRAL0000000000000001';
          const vlRes = await client.tts.synthesize({
            text: text,
            language: 'uz',
            voiceId: cleanVoiceId
          });
          const base64 = Buffer.from(vlRes.audio).toString('base64');
          const dataUri = `data:audio/mp3;base64,${base64}`;

          res.statusCode = 200;
          return res.end(JSON.stringify({
            success: true,
            audioUrl: dataUri,
            engine: 'voicelab',
            voice: cleanVoiceId,
            text: text
          }));
        } catch (vlErr) {
          console.error('VoiceLab error:', vlErr.message);
          // Fall through to Edge Neural fallback
        }
      }
    }

    // 2. Microsoft Edge Neural fallback (100% Free)
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

      res.statusCode = 200;
      return res.end(JSON.stringify({
        success: true,
        audioUrl: dataUri,
        engine: 'edge',
        voice: edgeVoice,
        text: text
      }));
    } catch (edgeErr) {
      res.statusCode = 500;
      return res.end(JSON.stringify({
        success: false,
        error: `Ovoz yaratish xatoligi: ${edgeErr.message}`
      }));
    }
  } catch (err) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ success: false, error: err.message }));
  }
};
