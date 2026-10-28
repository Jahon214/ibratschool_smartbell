const ttsHandler = require('./tts');
const voicesHandler = require('./voices');

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.includes('/voices')) {
    return voicesHandler(req, res);
  }
  if (pathname.includes('/tts')) {
    return ttsHandler(req, res);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', service: 'school-bell-api' }));
};
