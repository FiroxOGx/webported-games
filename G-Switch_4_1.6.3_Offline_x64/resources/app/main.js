const { app, BrowserWindow, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');

const GAME_ORIGIN = 'https://seriusgames.com';
const GAME_PREFIX = '/html5/g-switch-4-1.6.3/';
const GAME_URL = GAME_ORIGIN + GAME_PREFIX;

function ensureDir(dirPath) {
  if (fs.existsSync(dirPath)) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.fnt': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8'
  })[ext] || 'application/octet-stream';
}

function localResponse(filePath, type = null) {
  return new Response(fs.readFileSync(filePath), {
    status: 200,
    headers: {
      'Content-Type': type || mimeFor(filePath),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

function safeLocal(rootDir, relativePath) {
  let decoded;
  try { decoded = decodeURIComponent(relativePath); }
  catch (_) { decoded = relativePath; }
  decoded = decoded.replace(/^[/\\]+/, '');
  const root = path.resolve(rootDir);
  const full = path.resolve(root, decoded);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

async function clearInheritedProgressOnFirstRun() {
  // G-Switch 4 stores browser progress under the original Serius Games origin.
  // Older portable builds used the same Electron profile, so a new copy could inherit
  // progress from a previous run. Clear it once per architecture/build, then keep progress normally.
  const markerName = `.gswitch4_1.6.3_first_run_clean_${process.arch}.done`;
  const markerPath = path.join(app.getPath('userData'), markerName);

  if (fs.existsSync(markerPath)) {
    console.log('[FIRST RUN CLEAN] already completed for', process.arch);
    return;
  }

  try {
    const ses = session.defaultSession;

    // Clear all Chromium storage belonging to the original game origin:
    // localStorage, IndexedDB, cookies, CacheStorage, service workers, etc.
    await ses.clearStorageData({ origin: GAME_ORIGIN });

    // Remove stale HTTP cache as well so the first clean launch cannot reuse old responses.
    await ses.clearCache();

    ensureDir(path.dirname(markerPath));
    fs.writeFileSync(markerPath, `G-Switch 4 v1.6.3 first-run progress reset completed\n${new Date().toISOString()}\n`, 'utf8');
    console.log('[FIRST RUN CLEAN] inherited progress cleared for', process.arch);
  } catch (err) {
    // Do not write the marker on failure; the next launch will try again.
    console.error('[FIRST RUN CLEAN ERROR]', err);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // F12 / Ctrl+Shift+I remains available, but don't force DevTools on every launch.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(GAME_URL)) event.preventDefault();
  });

  win.loadURL(GAME_URL);
}

app.whenReady().then(async () => {
  const handler = async (request) => {
    const url = new URL(request.url);

    // Serve the game under its ORIGINAL origin/base URL.
    // IMPORTANT: only exact relative paths are accepted. No basename fallback.
    // This prevents assets with the same filename from different atlases/levels being mixed.
    if (url.hostname === 'seriusgames.com' && url.pathname.startsWith(GAME_PREFIX)) {
      let rel = url.pathname.slice(GAME_PREFIX.length);
      if (!rel || rel.endsWith('/')) rel += 'index.html';

      const localPath = safeLocal(__dirname, rel);
      if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        console.log('[ASSET EXACT]', rel);
        return localResponse(localPath);
      }

      // Exact-path network fallback only. If a real resource is missing locally,
      // fetch that SAME path from the original host and cache it at the SAME path.
      try {
        const response = await net.fetch(request.url, { bypassCustomProtocolHandlers: true });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && !contentType.toLowerCase().includes('text/html')) {
          const buf = Buffer.from(await response.arrayBuffer());
          if (localPath) {
            ensureDir(path.dirname(localPath));
            fs.writeFileSync(localPath, buf);
            console.log('[ASSET RECOVERED EXACT]', rel);
          }
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': contentType || mimeFor(rel),
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store'
            }
          });
        }
      } catch (e) {
        console.warn('[ASSET NETWORK ERROR]', rel, e.message);
      }

      console.warn('[ASSET MISSING EXACT]', rel);
      return new Response('404', {
        status: 404,
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Poki SDK mirror/fallback.
    if (url.hostname === 'game-cdn.poki.com') {
      const rel = url.pathname.replace(/^\//, '');
      const localPath = safeLocal(path.join(__dirname, 'game-cdn.poki.com'), rel);
      if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        return localResponse(localPath);
      }
      if (url.pathname.includes('poki-sdk')) {
        return localResponse(path.join(__dirname, 'poki-sdk.js'), 'application/javascript; charset=utf-8');
      }
    }

    // Creator API. Authentication must be forwarded without changing the request.
    // The stable offline wrapper used net.fetch(request.url), which converts POST
    // requests such as /verify_code and Discord /auth_code into GET requests.
    if (url.hostname === 'api.gscreator.com') {
      const cleanPath = url.pathname.replace(/\/+/g, '/');
      const method = (request.method || 'GET').toUpperCase();
      const isUserRequest = cleanPath.startsWith('/db/user/');

      // Sign-in/account endpoints are always live and never cached. This also lets the
      // Discord callback HTML load normally in its popup so window.opener.postMessage()
      // can return the OAuth code/state to G-Switch.
      if (isUserRequest) {
        try {
          console.log('[AUTH FORWARD]', method, cleanPath + url.search);
          return await net.fetch(request, { bypassCustomProtocolHandlers: true });
        } catch (e) {
          console.warn('[AUTH NETWORK ERROR]', method, cleanPath, e.message);
          return new Response(JSON.stringify({ error: 'network_unavailable' }), {
            status: 503,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': GAME_ORIGIN,
              'Access-Control-Allow-Credentials': 'true',
              'Cache-Control': 'no-store'
            }
          });
        }
      }

      // Other POST/PUT/etc. API requests also keep method, body and headers intact.
      // They are deliberately not cached.
      if (method !== 'GET') {
        try {
          console.log('[API FORWARD]', method, cleanPath + url.search);
          return await net.fetch(request, { bypassCustomProtocolHandlers: true });
        } catch (e) {
          console.warn('[API NETWORK ERROR]', method, cleanPath, e.message);
          return new Response('{}', {
            status: 503,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }

      // GET level/list data keeps the exact-path offline cache from the stable build.
      const querySuffix = url.search ? '_' + Buffer.from(url.search).toString('hex') : '';
      const safeName = (cleanPath.replace(/[^a-zA-Z0-9]/g, '_') + querySuffix + '.json');
      const cached = path.join(__dirname, 'api_cache', safeName);

      if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
        console.log('[LEVEL CACHE EXACT]', cleanPath + url.search);
        return localResponse(cached, 'application/json; charset=utf-8');
      }

      try {
        const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
        if (response.ok) {
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          const text = await response.text();
          if (text.trim() && !contentType.includes('text/html') && !/^\s*</.test(text)) {
            ensureDir(path.dirname(cached));
            fs.writeFileSync(cached, text);
            console.log('[LEVEL FETCHED EXACT]', cleanPath + url.search);
            return new Response(text, {
              status: response.status,
              headers: {
                'Content-Type': contentType || 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store'
              }
            });
          }
        }
      } catch (e) {
        console.warn('[LEVEL NETWORK ERROR]', cleanPath + url.search, e.message);
      }

      const fallback = /\/levels\//i.test(cleanPath) ? '{"results":{},"rating_mode":0}' : '{}';
      return new Response(fallback, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  };

  protocol.handle('https', handler);
  protocol.handle('http', handler);
  await clearInheritedProgressOnFirstRun();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
