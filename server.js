const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { VoiceLab } = require('@voicelab/sdk');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const IS_VERCEL = !!process.env.VERCEL;
const CACHE_DIR = IS_VERCEL ? path.join('/tmp', 'tts_cache') : path.join(ROOT, 'audio', 'tts_cache');
const NARAKEET_KEY_FILE = path.join(ROOT, '.narakeet_key');
const VOICELAB_KEY_FILE = path.join(ROOT, '.voicelab_key');

// Faqat yozish mumkin bo'lgan muhitda kesh papkasini yaratish
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem (Vercel) bo'lsa xatoni e'tiborsiz qoldiramiz
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

const DEFAULT_VOICELAB_KEY = 'vlk_KXxN2j-01fkHVKk48qvGcZ9RkWW0n0UfrRLHcARyPD0';

function getVoiceLabKey() {
  if (process.env.VOICELAB_API_KEY) return process.env.VOICELAB_API_KEY.trim();
  if (fs.existsSync(VOICELAB_KEY_FILE)) {
    try { return fs.readFileSync(VOICELAB_KEY_FILE, 'utf8').trim(); } catch (e) {}
  }
  return DEFAULT_VOICELAB_KEY;
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
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
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
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

// 1. Generate Edge TTS (100% XOTIRADA - READ-ONLY DISKGA TEGINMAYDI)
async function generateEdgeTtsAudioBuffer(text, voiceCode) {
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

// 2. Generate VoiceLab TTS
async function generateVoiceLabTtsBuffer(text, voiceId, apiKey) {
  const key = apiKey || getVoiceLabKey();
  if (!key) throw new Error("VoiceLab API kaliti kiritilmagan");
  const client = new VoiceLab({ apiKey: key });
  const cleanVoiceId = (voiceId && voiceId.startsWith('voice_')) ? voiceId : 'voice_01J9NEUTRAL0000000000000001';
  
  const res = await client.tts.synthesize({
    text: text,
    language: 'uz',
    voiceId: cleanVoiceId
  });

  return Buffer.from(res.audio);
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

  // 1. API: List of voices (Edge Neural Bepul + VoiceLab)
  if ((pathname === '/api/voices' || pathname.endsWith('/voices')) && req.method === 'GET') {
    const voicelabVoices = await fetchVoiceLabVoices();
    const hasVlKey = !!getVoiceLabKey();
    const hasNkKey = !!getNarakeetKey();

    return sendJsonResponse(res, 200, {
      success: true,
      hasVoiceLabKey: hasVlKey,
      hasNarakeetKey: hasNkKey,
      voices: [
        // Edge Neural (Free, Reliable, Instant)
        { id: 'madina', name: "Madina (O'zbekcha ayol) — 100% Bepul", engine: 'edge', gender: 'female', default: true },
        { id: 'sardor', name: "Sardor (O'zbekcha erkak) — 100% Bepul", engine: 'edge', gender: 'male', default: false },
        
        // VoiceLab (O'zbek Milliy AI Diktorlari)
        ...voicelabVoices
      ]
    });
  }

  // 2. API: Universal TTS
  if ((pathname === '/api/tts' || pathname.endsWith('/tts')) && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const text = (body.text || '').trim();
      let voice = body.voice || 'madina';
      let engine = body.engine || (voice.startsWith('voice_') ? 'voicelab' : 'edge');
      let apiKey = body.apiKey || '';

      if (!text) {
        return sendJsonResponse(res, 400, { success: false, error: 'Matn (text) kiritilmagan' });
      }

      const cacheFileName = getCacheFilename(engine, voice, text);
      const cacheFilePath = path.join(CACHE_DIR, cacheFileName);

      // Keshda mavjud bo'lsa qaytarish
      if (!IS_VERCEL) {
        try {
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
        } catch (e) {}
      }

      // --- ENGINE 1: VoiceLab.uz (Agar ovoz voice_ bo'lsa) ---
      if (engine === 'voicelab' || voice.startsWith('voice_')) {
        try {
          const buffer = await generateVoiceLabTtsBuffer(text, voice, apiKey);
          const dataUri = `data:audio/mp3;base64,${buffer.toString('base64')}`;
          
          if (!IS_VERCEL) {
            try { fs.writeFileSync(cacheFilePath, buffer); } catch (e) {}
          }

          return sendJsonResponse(res, 200, {
            success: true,
            audioUrl: IS_VERCEL ? dataUri : `/audio/tts_cache/${cacheFileName}`,
            cached: false,
            engine: 'voicelab',
            voice: voice,
            text: text
          });
        } catch (vlErr) {
          console.warn('VoiceLab xatosi, bepul Madina ovoziga o\'tkazilmoqda:', vlErr.message);
          // 402 bo'lsa yoki kredit tugasa, avtomatik ravishda bepul Madina ovoziga o'tish
          try {
            const fbBuffer = await generateEdgeTtsAudioBuffer(text, 'madina');
            const dataUri = `data:audio/mp3;base64,${fbBuffer.toString('base64')}`;

            return sendJsonResponse(res, 200, {
              success: true,
              audioUrl: dataUri,
              cached: false,
              engine: 'edge_fallback',
              voice: 'madina',
              isFallback: true,
              note: "VoiceLab hisobingizda limit tugagan (402). E'lon avtomatik ravishda bepul 'Madina' ovozida yaratildi!",
              text: text
            });
          } catch (fbErr) {
            return sendJsonResponse(res, 500, {
              success: false,
              error: `Ovoz yaratish xatoligi: ${fbErr.message}`
            });
          }
        }
      }

      // --- ENGINE 2: Microsoft Edge Neural TTS (100% BEPUL VA CHEKSIZ) ---
      try {
        const buffer = await generateEdgeTtsAudioBuffer(text, voice);
        const dataUri = `data:audio/mp3;base64,${buffer.toString('base64')}`;

        // Localhostda faylga saqlab qo'yish (Vercelda esa xotiradan to'g'ridan-to'g'ri dataUri berish)
        if (!IS_VERCEL) {
          try {
            fs.writeFileSync(cacheFilePath, buffer);
            return sendJsonResponse(res, 200, {
              success: true,
              audioUrl: `/audio/tts_cache/${cacheFileName}`,
              cached: false,
              engine: 'edge',
              voice: voice,
              text: text
            });
          } catch (e) {}
        }

        return sendJsonResponse(res, 200, {
          success: true,
          audioUrl: dataUri,
          cached: false,
          engine: 'edge',
          voice: voice,
          text: text
        });
      } catch (edgeErr) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: `Edge TTS xatoligi: ${edgeErr.message}`
        });
      }
    } catch (err) {
      return sendJsonResponse(res, 500, {
        success: false,
        error: `Server xatoligi: ${err.message}`
      });
    }
  }

  // 3. API: Cache Status
  if ((pathname === '/api/cache-status' || pathname.endsWith('/cache-status')) && req.method === 'GET') {
    try {
      const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3')) : [];
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
      return sendJsonResponse(res, 200, { success: true, count: 0, totalBytes: 0, files: [] });
    }
  }

  // 4. API: VoiceLab Key Management
  if (pathname === '/api/voicelab/key' || pathname.endsWith('/voicelab/key')) {
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
        if (body.key !== undefined && !IS_VERCEL) {
          try { fs.writeFileSync(VOICELAB_KEY_FILE, body.key.trim(), 'utf8'); } catch (e) {}
          cachedVoiceLabVoices = null;
        }
        return sendJsonResponse(res, 200, { success: true, message: 'VoiceLab API kaliti saqlandi' });
      } catch (e) {
        return sendJsonResponse(res, 400, { success: false, error: e.message });
      }
    }
  }

  // 5. Statik fayllarni uzatish
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  let filePath = path.join(ROOT, reqPath);
  if (!fs.existsSync(filePath)) {
    const pub = path.join(ROOT, 'public', reqPath);
    if (fs.existsSync(pub)) {
      filePath = pub;
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
      'Cache-Control': ext === '.mp3' ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// Vercel serverless eksporti
module.exports = server;

// Standalone server (Localhost)
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running at http://localhost:${PORT}/ (VoiceLab.uz + Edge Neural TTS)`);
  });
}
