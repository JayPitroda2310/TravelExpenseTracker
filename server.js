const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const ROOT_WITH_SEP = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

loadEnvFile(path.join(ROOT, '.env'));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 5500);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function boolEnv(value) {
  return String(value || '').toLowerCase() === 'true';
}

function runtimeConfigScript() {
  const config = {
    supabase: {
      url: process.env.SUPABASE_URL || 'https://titsruvqhttaomudvpfi.supabase.co',
      anonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_IhPSHDIrvBeajV-RH-DoLw_lDMumNNQ',
      stateId: process.env.SUPABASE_STATE_ID || 'trip-vault-global'
    },
    firebase: {
      enabled: boolEnv(process.env.FIREBASE_ENABLED),
      databaseURL: process.env.FIREBASE_DATABASE_URL || '',
      statePath: process.env.FIREBASE_STATE_PATH || 'tripvault_state/trip-vault-global',
      authToken: process.env.FIREBASE_AUTH_TOKEN || ''
    }
  };
  return `window.TRIP_VAULT_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
}

function handler(req, res) {
  const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  let pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname === '/') pathname = '/trip-vault.html';

  if (pathname === '/runtime-config.js') {
    return send(res, 200, runtimeConfigScript(), MIME['.js']);
  }

  const safePath = path.normalize(path.join(ROOT, pathname));
  if (safePath !== ROOT && !safePath.startsWith(ROOT_WITH_SEP)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(safePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      return send(res, 404, 'Not found');
    }

    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(safePath, (readErr, data) => {
      if (readErr) return send(res, 500, 'Server error');
      send(res, 200, data, mime);
    });
  });
}

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log(`Trip Vault running at http://${HOST}:${PORT}/trip-vault.html`);
  });
}

module.exports = handler;
