// "ChatGPT로 로그인" (Sign in with ChatGPT) — PC 설치판 전용.
// OpenAI 공개 OAuth(PKCE + 동적 앱 등록) 흐름으로 로그인하고, ChatGPT Plus/Pro 구독 사용량으로
// Responses API 를 호출한다. API 키가 필요 없다. 토큰은 OS 보안 저장소(safeStorage)로 암호화해 저장한다.
const { app, shell, safeStorage } = require('electron');
const { createHash, randomBytes } = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const APP_NAME = '우리집 외벽 색 바꾸기';
const rnd = () => randomBytes(32).toString('base64url');

let discoveryCache = null;
async function discovery() {
  if (discoveryCache) return discoveryCache;
  const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  const d = await r.json();
  if (!r.ok || d.issuer !== ISSUER) throw new Error('ChatGPT 로그인 설정을 확인할 수 없어요.');
  for (const k of ['authorization_endpoint', 'token_endpoint']) {
    if (typeof d[k] !== 'string' || new URL(d[k]).origin !== ISSUER) throw new Error('ChatGPT 로그인 설정이 올바르지 않아요.');
  }
  discoveryCache = d;
  return d;
}

/* ---------- encrypted storage ---------- */
const storeFile = () => path.join(app.getPath('userData'), 'chatgpt-connection.bin');
function load() {
  try {
    const buf = fs.readFileSync(storeFile());
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
}
function save(conn) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서는 로그인 정보를 안전하게 저장할 수 없어요.');
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), safeStorage.encryptString(JSON.stringify(conn)), { mode: 0o600 });
}
function clear() { try { fs.unlinkSync(storeFile()); } catch { /* none */ } }

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

async function tokenRequest(params) {
  const d = await discovery();
  const r = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error_description || j.error || ('HTTP ' + r.status)));
  return j;
}

function credsFrom(j, prev) {
  if (!j.access_token) throw new Error('ChatGPT 가 사용 권한을 주지 않았어요. (Plus/Pro 구독과 "플랜 사용 허용"을 확인해 주세요)');
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || (prev && prev.refreshToken),
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    scopes: String(j.scope || (prev && prev.scopes) || '').split(/\s+/).filter(Boolean),
  };
}

/* ---------- sign in ---------- */
let pending = null;
async function signIn() {
  if (pending) { pending.abort(); pending = null; }
  const ctl = new AbortController(); pending = ctl;
  const prev = load();
  const d = await discovery();
  const state = rnd(), nonce = rnd(), verifier = rnd();

  // loopback callback listener on a free port
  let port = 0;
  let resolveCb, rejectCb;
  const result = new Promise((res, rej) => { resolveCb = res; rejectCb = rej; });
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let url;
    try { url = new URL(req.url || '/', `http://127.0.0.1:${port}`); } catch { res.writeHead(400).end(); return; }
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) { res.writeHead(404).end('Not found'); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>로그인 완료</title><body style="font:18px sans-serif;max-width:30rem;margin:18vh auto;text-align:center"><h1>로그인 완료</h1><p>이 창을 닫고 <b>우리집 외벽 색 바꾸기</b> 프로그램으로 돌아가세요.</p></body>');
    if (url.searchParams.has('error')) { rejectCb(new Error(url.searchParams.get('error_description') || url.searchParams.get('error'))); return; }
    const code = url.searchParams.get('code');
    const clientId = url.searchParams.get('client_id') || (prev && prev.clientId);
    if (!code || !clientId || clientId === 'dynamic_agent_client' || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId)) {
      rejectCb(new Error('ChatGPT 앱 등록이 끝나지 않았어요. 다시 시도해 주세요.')); return;
    }
    resolveCb({ code, clientId });
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => { port = server.address().port; res(); }); });
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const timer = setTimeout(() => rejectCb(new Error('로그인 시간이 초과됐어요. 다시 시도해 주세요.')), 10 * 60 * 1000);
  ctl.signal.addEventListener('abort', () => rejectCb(new Error('로그인을 취소했어요.')));
  try {
    const auth = new URL(d.authorization_endpoint);
    auth.search = new URLSearchParams({
      client_id: (prev && prev.clientId) || 'dynamic_agent_client',
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state, nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString();
    if (!(prev && prev.clientId)) auth.searchParams.set('agent_name_hint', APP_NAME);
    if (prev && prev.email) auth.searchParams.set('login_hint', prev.email);
    await shell.openExternal(auth.href);
    const cb = await result;
    // keep the issued client id even if the code exchange fails, so we don't register a new app each time
    try { save(Object.assign({}, prev || {}, { clientId: cb.clientId, status: 'registered' })); } catch { /* ignore */ }
    const j = await tokenRequest({
      grant_type: 'authorization_code', client_id: cb.clientId, code: cb.code,
      code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE,
    });
    const idp = decodeJwt(j.id_token);
    if (!idp || idp.nonce !== nonce || (idp.aud !== cb.clientId && !(Array.isArray(idp.aud) && idp.aud.includes(cb.clientId)))) {
      throw new Error('ChatGPT 계정을 확인하지 못했어요. 다시 로그인해 주세요.');
    }
    const conn = { clientId: cb.clientId, status: 'connected', email: idp.email || '', name: idp.name || '', subject: idp.sub, ...credsFrom(j) };
    save(conn);
    return status();
  } finally {
    clearTimeout(timer);
    server.close();
    if (pending === ctl) pending = null;
  }
}

async function accessToken() {
  let c = load();
  if (!c || c.status !== 'connected' || !c.accessToken) throw new Error('ChatGPT 로그인이 필요해요.');
  if (Date.now() > c.expiresAt - 60 * 1000) {
    if (!c.refreshToken) throw new Error('ChatGPT 로그인이 만료됐어요. 다시 로그인해 주세요.');
    const j = await tokenRequest({ grant_type: 'refresh_token', client_id: c.clientId, refresh_token: c.refreshToken, resource: RESOURCE });
    c = { ...c, ...credsFrom(j, c) };
    save(c);
  }
  return c.accessToken;
}

function status() {
  const c = load();
  const connected = !!(c && c.status === 'connected' && c.accessToken);
  return { connected, email: connected ? c.email : '', sharing: connected && (c.scopes || []).includes('chatgpt.tokens.use.direct') };
}

async function signOut() {
  const c = load();
  clear();
  try {
    const d = await discovery();
    if (c && c.refreshToken && d.revocation_endpoint) {
      await fetch(d.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: c.refreshToken, token_type_hint: 'refresh_token', client_id: c.clientId }) });
    }
  } catch { /* local credentials already removed */ }
  return status();
}

async function listModels() {
  const tok = await accessToken();
  const r = await fetch(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  const list = Array.isArray(j.models) ? j.models : Array.isArray(j.data) ? j.data : [];
  return list.filter(m => !m.visibility || m.visibility === 'list').map(m => m.slug || m.id).filter(Boolean);
}

/** prompt + JPEG(base64) → model text (streamed Responses API, plan usage) */
async function ask(prompt, imageB64, model) {
  const tok = await accessToken();
  if (!model) { const ms = await listModels(); model = ms[0]; if (!model) throw new Error('사용할 수 있는 ChatGPT 모델이 없어요.'); }
  const r = await fetch(`${RESOURCE}/responses`, {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      model, store: false, stream: true,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: 'data:image/jpeg;base64,' + imageB64 }] }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && (j.error.message || j.error.code)) || j.error || ('HTTP ' + r.status);
    throw new Error(r.status === 429 ? 'ChatGPT 구독 사용량 한도에 도달했어요. 잠시 후 다시 해 주세요.' : String(msg));
  }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', done = false;
  while (!done) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
      else if (ev.type === 'response.completed') { done = true; break; }
      else if (ev.type === 'response.failed' || ev.type === 'error') {
        const e = ev.response && ev.response.error || ev.error || ev;
        throw new Error((e && (e.message || e.code)) || 'ChatGPT 응답 실패');
      }
    }
  }
  try { reader.cancel(); } catch { /* ignore */ }
  return { text, model };
}

/** AI 지우기: 원본(PNG) + 마스크(PNG, 지울 곳 투명) → 새 이미지(base64 PNG). Responses API 의 image_generation 도구 사용 */
async function editImage(imageB64, maskB64, prompt, model) {
  const tok = await accessToken();
  if (!model) { const ms = await listModels(); model = ms[0]; if (!model) throw new Error('사용할 수 있는 ChatGPT 모델이 없어요.'); }
  const r = await fetch(`${RESOURCE}/responses`, {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      model, store: false, stream: true,
      tools: [{ type: 'image_generation', input_image_mask: { image_url: 'data:image/png;base64,' + maskB64 }, quality: 'high', output_format: 'png' }],
      tool_choice: { type: 'image_generation' },
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: 'data:image/png;base64,' + imageB64 }] }],
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && (j.error.message || j.error.code)) || j.error || ('HTTP ' + r.status);
    throw new Error(r.status === 429 ? 'ChatGPT 구독 사용량 한도에 도달했어요. 잠시 후 다시 해 주세요.' : String(msg));
  }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', image = null;
  const take = (item) => { if (item && item.type === 'image_generation_call' && typeof item.result === 'string' && item.result) image = item.result; };
  outer: while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'response.output_item.done') take(ev.item);
      else if (ev.type === 'response.completed') { ((ev.response && ev.response.output) || []).forEach(take); break outer; }
      else if (ev.type === 'response.failed' || ev.type === 'error') {
        const e = ev.response && ev.response.error || ev.error || ev;
        throw new Error((e && (e.message || e.code)) || 'ChatGPT 이미지 생성 실패');
      }
    }
  }
  try { reader.cancel(); } catch { /* ignore */ }
  if (!image) throw new Error('ChatGPT가 이미지를 돌려주지 않았어요. (구독 로그인으로 이미지 편집이 허용되지 않을 수 있어요)');
  return { image };
}

module.exports = { signIn, signOut, status, ask, listModels, editImage };
