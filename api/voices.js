const { VoiceLab } = require('@voicelab/sdk');

const DEFAULT_KEY = 'vlk_KXxN2j-01fkHVKk48qvGcZ9RkWW0n0UfrRLHcARyPD0';

function getVoiceLabKey() {
  return process.env.VOICELAB_API_KEY || DEFAULT_KEY;
}

let cachedVoices = null;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const key = getVoiceLabKey();
  let vlVoices = [];

  if (cachedVoices) {
    vlVoices = cachedVoices;
  } else if (key) {
    try {
      const client = new VoiceLab({ apiKey: key });
      const resData = await client.voices.list({ language: 'uz' });
      cachedVoices = (resData.data || []).map(v => ({
        id: v.id,
        name: `${v.displayName || 'Ovoz'} (${v.shortDescription || 'VoiceLab'})`,
        engine: 'voicelab',
        gender: v.gender || 'neutral',
        language: v.language || 'uz'
      }));
      vlVoices = cachedVoices;
    } catch (e) {
      console.error('Error fetching VoiceLab voices:', e.message);
    }
  }

  res.statusCode = 200;
  return res.end(JSON.stringify({
    success: true,
    hasVoiceLabKey: !!key,
    voices: [
      { id: 'madina', name: "Madina (O'zbekcha ayol) — 100% Bepul", engine: 'edge', gender: 'female', default: true },
      { id: 'sardor', name: "Sardor (O'zbekcha erkak) — 100% Bepul", engine: 'edge', gender: 'male', default: false },
      ...vlVoices
    ]
  }));
};
