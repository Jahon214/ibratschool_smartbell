const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { VoiceLab } = require('@voicelab/sdk');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, 'audio', 'tts_cache');
const NARAKEET_KEY_FILE = path.join(ROOT, '.narakeet_key');
const VOICELAB_KEY_FILE = path.join(ROOT, '.voicelab_key');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4'
};

function getVoiceLabKey() {
  if (process.env.VOICELAB_API_KEY) return process.env.VOICELAB_API_KEY.trim();
  if (fs.existsSync(VOICELAB_KEY_FILE)) {
    try { return fs.readFileSync(VOICELAB_KEY_FILE, 'utf8').trim(); } catch (e) {}
  }
  return '';
}

function getNarakeetKey() {
  if (process.env.NARAKEET_API_KEY) return process.env.NARAKEET_API_KEY.trim();
  if (fs.existsSync(NARAKEET_KEY_FILE)) {
    try { return fs.readFileSync(NARAKEET_KEY_FILE, 'utf8').trim(); } catch (e) {}
  }
  return '';
}

function getCacheFilename(engine, voice, text) {
  const hash = crypto.createHash('md5')
    .update(`${engine || 'edge'}_${voice || 'madina'}_${(text || '').trim().toLowerCase()}`)
    .digest('hex');
  return `tts_${engine || 'edge'}_${hash}.mp3`;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

// 1. Generate Edge TTS (100% FREE, NO KEY)
async function generateEdgeTtsAudio(text, voiceCode, targetFilePath) {
  const tts = new MsEdgeTTS();
  const voice = voiceCode === 'sardor' || voiceCode === 'uz-UZ-SardorNeural'
    ? 'uz-UZ-SardorNeural'
    : 'uz-UZ-MadinaNeural';

  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(targetFilePath);
    audioStream.pipe(fileStream);
    fileStream.on('finish', () => resolve(true));
    fileStream.on('error', reject);
    audioStream.on('error', reject);
  });
}

// 2. Generate VoiceLab TTS
async function generateVoiceLabTtsAudio(text, voiceId, targetFilePath, apiKey) {
  const key = apiKey || getVoiceLabKey();
  if (!key) throw new Error("VoiceLab API kaliti kiritilmagan");
  const client = new VoiceLab({ apiKey: key });
  const cleanVoiceId = (voiceId && voiceId.startsWith('voice_')) ? voiceId : 'voice_01J9NEUTRAL0000000000000001';
  
  const res = await client.tts.synthesize({
    text: text,
    language: 'uz',
    voiceId: cleanVoiceId
  });

  const buffer = Buffer.from(res.audio);
  fs.writeFileSync(targetFilePath, buffer);
  return true;
}

let cachedVoiceLabVoices = null;
async function fetchVoiceLabVoices(apiKey) {
  if (cachedVoiceLabVoices && cachedVoiceLabVoices.length > 0) return cachedVoiceLabVoices;
  const key = apiKey || getVoiceLabKey();
  if (!key) return [];
  try {
    const client = new VoiceLab({ apiKey: key });
    const res = await client.voices.list({ language: 'uz' });
    cachedVoiceLabVoices = (res.data || []).map(v => ({
      id: v.id,
      name: `${v.displayName || 'Ovoz'} (${v.shortDescription || 'VoiceLab'})`,
      engine: 'voicelab',
      gender: v.gender || 'neutral',
      language: v.language || 'uz'
    }));
    return cachedVoiceLabVoices;
  } catch (err) {
    console.error('Error loading VoiceLab voices:', err.message);
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
    });
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURI(urlObj.pathname);

  // 1. API: List of voices (VoiceLab + Edge Neural + Narakeet)
  if (pathname === '/api/voices' && req.method === 'GET') {
    const voicelabVoices = await fetchVoiceLabVoices();
    const hasVlKey = !!getVoiceLabKey();
    const hasNkKey = !!getNarakeetKey();

    return sendJsonResponse(res, 200, {
      success: true,
      hasVoiceLabKey: hasVlKey,
      hasNarakeetKey: hasNkKey,
      voices: [
        // Edge Neural (Free, Reliable)
        { id: 'madina', name: 'Madina (O\'zbekcha ayol) — 100% Bepul', engine: 'edge', gender: 'female', default: !hasVlKey },
        { id: 'sardor', name: 'Sardor (O\'zbekcha erkak) — 100% Bepul', engine: 'edge', gender: 'male', default: false },
        
        // VoiceLab (Uzbek National AI TTS)
        ...voicelabVoices,
        
        // Narakeet (Optional)
        { id: 'zulfiya', name: 'Zulfiya (Narakeet)', engine: 'narakeet', gender: 'female', requiresKey: true },
        { id: 'shavkat', name: 'Shavkat (Narakeet)', engine: 'narakeet', gender: 'male', requiresKey: true }
      ]
    });
  }

  // 2. API: Universal TTS (VoiceLab / Edge / Narakeet)
  if ((pathname === '/api/tts' || pathname === '/api/voicelab/tts' || pathname === '/api/narakeet/tts') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const text = (body.text || '').trim();
      let engine = body.engine || 'edge';
      let voice = body.voice || 'madina';
      let apiKey = body.apiKey || '';

      if (!text) {
        return sendJsonResponse(res, 400, { success: false, error: 'Matn (text) kiritilmagan' });
      }

      // Automatically determine engine by voice
      if (voice.startsWith('voice_') || engine === 'voicelab' || pathname === '/api/voicelab/tts') {
        engine = 'voicelab';
      } else if (voice === 'madina' || voice === 'sardor' || engine === 'edge') {
        engine = 'edge';
      } else if (voice === 'zulfiya' || voice === 'shavkat' || engine === 'narakeet') {
        engine = 'narakeet';
      }

      const cacheFileName = getCacheFilename(engine, voice, text);
      const cacheFilePath = path.join(CACHE_DIR, cacheFileName);

      // Return from cache if exists
      if (fs.existsSync(cacheFilePath) && fs.statSync(cacheFilePath).size > 100) {
        return sendJsonResponse(res, 200, {
          success: true,
          audioUrl: `/audio/tts_cache/${cacheFileName}`,
          cached: true,
          engine: engine,
          voice: voice,
          text: text
        });
      }

      // --- ENGINE 1: VoiceLab.uz (Uzbek AI TTS) ---
      if (engine === 'voicelab') {
        try {
          await generateVoiceLabTtsAudio(text, voice, cacheFilePath, apiKey);
          return sendJsonResponse(res, 200, {
            success: true,
            audioUrl: `/audio/tts_cache/${cacheFileName}`,
            cached: false,
            engine: 'voicelab',
            voice: voice,
            text: text
          });
        } catch (vlErr) {
          console.error('VoiceLab generation failed, falling back to Edge Neural:', vlErr.message);
          // Fallback to Edge Neural if VoiceLab error happens (e.g. 402 insufficient credits)
          try {
            const edgeFallbackName = getCacheFilename('edge', 'madina', text);
            const edgeFallbackPath = path.join(CACHE_DIR, edgeFallbackName);
            await generateEdgeTtsAudio(text, 'madina', edgeFallbackPath);
            return sendJsonResponse(res, 200, {
              success: true,
              audioUrl: `/audio/tts_cache/${edgeFallbackName}`,
              cached: false,
              engine: 'edge_fallback',
              voice: 'madina',
              isFallback: true,
              note: "VoiceLab balansi tugagani (402) sababli bepul Madina ovoziga o'tkazildi",
              text: text
            });
          } catch (fbErr) {
            console.error('Edge fallback failed as well:', fbErr);
            const isPayment = (vlErr.status === 402 || (vlErr.message && vlErr.message.includes('402')));
            const errMsg = isPayment
              ? "VoiceLab hisobingizda balans tugagan (402 Payment Required). Ovoz ro'yxatidan bepul 'Madina' yoki 'Sardor' ovozini tanlang!"
              : `VoiceLab xatoligi: ${vlErr.message}`;
            return sendJsonResponse(res, 400, {
              success: false,
              error: errMsg
            });
          }
        }
      }

      // --- ENGINE 2: Microsoft Edge Neural TTS (100% FREE, NO KEY NEEDED) ---
      if (engine === 'edge') {
        try {
          await generateEdgeTtsAudio(text, voice, cacheFilePath);
          return sendJsonResponse(res, 200, {
            success: true,
            audioUrl: `/audio/tts_cache/${cacheFileName}`,
            cached: false,
            engine: 'edge',
            voice: voice,
            text: text
          });
        } catch (edgeErr) {
          console.error('Edge TTS generation failed:', edgeErr);
          return sendJsonResponse(res, 500, {
            success: false,
            error: `Edge TTS xatoligi: ${edgeErr.message}`
          });
        }
      }

      // --- ENGINE 3: Narakeet TTS (Requires API Key) ---
      if (engine === 'narakeet') {
        const nKey = apiKey || getNarakeetKey();
        if (!nKey) {
          return sendJsonResponse(res, 400, {
            success: false,
            error: 'Narakeet API kaliti yo\'q. Buning o\'rniga VoiceLab yoki bepul Madina/Sardor ovozini tanlang!'
          });
        }

        const narakeetVoice = (voice === 'shavkat') ? 'shavkat' : 'zulfiya';
        const narakeetUrl = `https://api.narakeet.com/text-to-speech/mp3?voice=${encodeURIComponent(narakeetVoice)}`;
        const narakeetRes = await fetch(narakeetUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/octet-stream',
            'Content-Type': 'text/plain; charset=utf-8',
            'x-api-key': nKey
          },
          body: text
        });

        if (!narakeetRes.ok) {
          let errDetails = '';
          try { errDetails = await narakeetRes.text(); } catch (e) {}
          return sendJsonResponse(res, narakeetRes.status, {
            success: false,
            error: `Narakeet API xatoligi: ${errDetails || 'Kalit xato yoki balans yo\'q'}`
          });
        }

        const audioBuffer = Buffer.from(await narakeetRes.arrayBuffer());
        fs.writeFileSync(cacheFilePath, audioBuffer);

        return sendJsonResponse(res, 200, {
          success: true,
          audioUrl: `/audio/tts_cache/${cacheFileName}`,
          cached: false,
          engine: 'narakeet',
          voice: narakeetVoice,
          text: text
        });
      }
    } catch (err) {
      console.error('TTS request error:', err);
      return sendJsonResponse(res, 500, {
        success: false,
        error: `Server xatoligi: ${err.message}`
      });
    }
  }

  // 3. API: Cache Status
  if (pathname === '/api/cache-status' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3'));
      let totalSize = 0;
      files.forEach(f => {
        try { totalSize += fs.statSync(path.join(CACHE_DIR, f)).size; } catch (e) {}
      });
      return sendJsonResponse(res, 200, {
        success: true,
        count: files.length,
        totalBytes: totalSize,
        files: files
      });
    } catch (e) {
      return sendJsonResponse(res, 500, { success: false, error: e.message });
    }
  }

  // 4. API: VoiceLab Key Management
  if (pathname === '/api/voicelab/key') {
    if (req.method === 'GET') {
      const key = getVoiceLabKey();
      return sendJsonResponse(res, 200, {
        hasKey: !!key,
        maskedKey: key ? (key.slice(0, 8) + '...' + key.slice(-4)) : ''
      });
    }
    if (req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (body.key !== undefined) {
          fs.writeFileSync(VOICELAB_KEY_FILE, body.key.trim(), 'utf8');
          cachedVoiceLabVoices = null; // reset cached voice list
          return sendJsonResponse(res, 200, { success: true, message: 'VoiceLab API kaliti saqlandi' });
        }
      } catch (e) {
        return sendJsonResponse(res, 400, { success: false, error: e.message });
      }
    }
  }

  // 5. Static File Serving
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  let filePath = path.join(ROOT, reqPath);
  if (!fs.existsSync(filePath)) {
    const publicPath = path.join(ROOT, 'public', reqPath);
    if (fs.existsSync(publicPath)) {
      filePath = publicPath;
    }
  }

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Taqiqlangan');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Fayl topilmadi');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.mp3' ? 'public, max-age=86400' : 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://localhost:${PORT}/ (VoiceLab.uz + Edge Neural TTS)`);
});
