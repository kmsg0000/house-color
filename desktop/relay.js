// 휴대폰(Android 앱) → 이 PC 의 ComfyUI 를 쓰게 해 주는 LAN 중계 서버.
//  - 기본 꺼짐. 사용자가 켤 때만 0.0.0.0:<port> 로 연다.
//  - 모든 요청에 접근 토큰(Bearer) 필수, 상수 시간 비교. 한 번에 작업 1개.
//  - CORS 는 Android 앱 출처(https://appassets.androidplatform.net)만 허용.
//  - 인터넷에 공개하지 말 것(공유기 포트포워딩 금지). 같은 Wi-Fi 안에서만 사용.
'use strict';
const http = require('http');
const os = require('os');
const { randomBytes, timingSafeEqual } = require('crypto');

const ALLOWED_ORIGINS = ['https://appassets.androidplatform.net'];
const MAX_BODY = 40 * 1024 * 1024;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
const newToken = () => randomBytes(18).toString('base64url');

function createRelay({ run, stats, segment }) {
  let server = null, token = null, port = 8766, busy = false;

  const tokenOk = h => {
    const m = /^Bearer\s+(.+)$/i.exec(h || ''); if (!m || !token) return false;
    const a = Buffer.from(m[1]), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const cors = (req, res) => {
    const o = req.headers.origin;
    if (o && ALLOWED_ORIGINS.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      // Chrome 계열 Private Network Access 사전 요청 대응 (https 앱 화면 → LAN 주소)
      if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  };
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  async function handler(req, res) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    if (!tokenOk(req.headers.authorization)) { send(res, 401, { error: '접근 토큰이 맞지 않아요.' }); return; }
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      let s = null; try { s = await stats(); } catch (e) { s = { ok: false, error: e.message }; }
      send(res, 200, { ok: true, app: 'house-color', comfy: s }); return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/edit' || url.pathname === '/api/segment')) {
      if (busy) { send(res, 429, { error: 'PC 가 다른 작업을 처리 중이에요. 잠시 후 다시 해 주세요.' }); return; }
      if (url.pathname === '/api/segment' && !segment) { send(res, 404, { error: '이 PC 앱은 정밀 선택을 지원하지 않아요. PC 앱을 업데이트해 주세요.' }); return; }
      let size = 0; const chunks = [];
      try {
        for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('사진이 너무 커요.'); chunks.push(c); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof body.image !== 'string' || !body.image) throw new Error('image 가 없어요.');
        busy = true;
        const image = Buffer.from(body.image, 'base64');
        const r = url.pathname === '/api/segment'
          ? await segment({ image, positive: body.positive, negative: body.negative, text: typeof body.text === 'string' ? body.text.slice(0, 200) : '' })
          : await run({ image, prompt: String(body.prompt || ''), megapixels: body.megapixels });
        send(res, 200, { image: r.image.toString('base64'), mime: r.mime });
      } catch (e) {
        send(res, 500, { error: String(e && e.message || e) });
      } finally { busy = false; }
      return;
    }
    send(res, 404, { error: 'not found' });
  }

  return {
    async start(opts = {}) {
      if (server) return this.status();
      port = Number(opts.port) || port;
      token = opts.token || token || newToken();
      server = http.createServer((req, res) => { handler(req, res).catch(e => send(res, 500, { error: e.message })); });
      server.requestTimeout = 20 * 60 * 1000;
      await new Promise((ok, no) => { server.once('error', no); server.listen(port, '0.0.0.0', ok); });
      return this.status();
    },
    async stop() { if (server) { await new Promise(r => server.close(() => r())); server = null; } return this.status(); },
    regenerate() { token = newToken(); return this.status(); },
    status() { return { running: !!server, port, token: server ? token : (token || ''), addresses: lanAddresses().map(a => `http://${a}:${port}`) }; },
    setToken(t) { token = t; },
  };
}

module.exports = { createRelay, lanAddresses };
