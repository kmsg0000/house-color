// 우리집 외벽 색 바꾸기 — 데스크톱(Windows / Mac) 실행 파일
const { app, BrowserWindow, session, shell, Menu, ipcMain } = require('electron');
const siwc = require('./siwc');
const comfy = require('./comfy');
const { createRelay } = require('./relay');
const fs = require('fs');
const path = require('path');

const AI_HOSTS = ['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com'];

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: '우리집 외벽 색 바꾸기',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // 외부 링크는 기본 브라우저로 열기
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // 저장한 사진은 "사진" 폴더에 바로 저장
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSavePath(path.join(app.getPath('pictures'), item.getFilename()));
    item.once('done', (_ev, state) => { if (state === 'completed') shell.showItemInFolder(item.getSavePath()); });
  });
}

// "ChatGPT로 로그인" — 결과는 {ok:true,data} 또는 {ok:false,error} 로 돌려준다
const wrap = fn => async (e, ...args) => { try { return { ok: true, data: await fn.apply(e, args) }; } catch (err) { return { ok: false, error: String(err && err.message || err) }; } };
ipcMain.handle('siwc:status', wrap(() => siwc.status()));
ipcMain.handle('siwc:signIn', wrap(() => siwc.signIn()));
ipcMain.handle('siwc:signOut', wrap(() => siwc.signOut()));
ipcMain.handle('siwc:models', wrap(() => siwc.listModels()));
ipcMain.handle('siwc:edit', wrap((img, mask, prompt, model) => siwc.editImage(String(img), String(mask), String(prompt), model ? String(model) : '')));
ipcMain.handle('siwc:ask', wrap((p, img, model) => siwc.ask(String(p), String(img), model ? String(model) : '')));

// ---------- 로컬 ComfyUI ----------
const cfgFile = () => path.join(app.getPath('userData'), 'comfy-config.json');
const wfFile = () => path.join(app.getPath('userData'), 'comfy-workflow.json');
function comfyCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return { url: 'http://127.0.0.1:8188', relayPort: 8766 }; } }
function saveCfg(c) { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c), { mode: 0o600 }); }
function loadWf() { try { return JSON.parse(fs.readFileSync(wfFile(), 'utf8')); } catch { return null; } }
let comfyJob = null;
async function comfyRun({ image, prompt, megapixels }, onProgress) {
  const wf = loadWf(); if (!wf) throw new Error('ComfyUI 워크플로(API JSON)를 먼저 불러와 주세요. (⚙ AI 설정 → 내 PC ComfyUI)');
  const c = comfyCfg();
  if (comfyJob) throw new Error('이미 ComfyUI 작업이 진행 중이에요.');
  comfyJob = new AbortController();
  try { return await comfy.runWorkflow({ baseUrl: c.url, workflow: wf, image, prompt, megapixels, nodes: c.nodes || undefined, onProgress, signal: comfyJob.signal }); }
  finally { comfyJob = null; }
}
ipcMain.handle('comfy:config', wrap(() => { const c = comfyCfg(); const wf = loadWf(); let det = null; if (wf) { try { det = comfy.detectNodes(wf); } catch (e) { det = { error: e.message }; } } return { url: c.url, hasWorkflow: !!wf, detected: det, nodes: c.nodes || null }; }));
ipcMain.handle('comfy:setUrl', wrap(url => { const c = comfyCfg(); c.url = String(url || 'http://127.0.0.1:8188').trim(); saveCfg(c); return c.url; }));
ipcMain.handle('comfy:setWorkflow', wrap(text => { const wf = JSON.parse(String(text)); const det = comfy.detectNodes(wf); fs.mkdirSync(path.dirname(wfFile()), { recursive: true }); fs.writeFileSync(wfFile(), JSON.stringify(wf)); return det; }));
ipcMain.handle('comfy:test', wrap(() => comfy.systemStats(comfyCfg().url)));
ipcMain.handle('comfy:cancel', wrap(() => { if (comfyJob) comfyJob.abort(); return true; }));
ipcMain.handle('comfy:run', wrap(async function (b64, prompt, megapixels) {
  const sender = this && this.sender;
  const r = await comfyRun({ image: Buffer.from(String(b64), 'base64'), prompt: String(prompt || ''), megapixels }, p => { try { sender && sender.send('comfy:progress', p); } catch { /* window closed */ } });
  return { image: r.image.toString('base64'), mime: r.mime };
}));

// ---------- 휴대폰 → 이 PC 중계 (기본 꺼짐) ----------
const relay = createRelay({ run: o => comfyRun(o, () => {}), stats: () => comfy.systemStats(comfyCfg().url) });
ipcMain.handle('relay:status', wrap(() => relay.status()));
ipcMain.handle('relay:start', wrap(async () => { const c = comfyCfg(); if (c.relayToken) relay.setToken(c.relayToken); const s = await relay.start({ port: c.relayPort || 8766 }); c.relayToken = s.token; saveCfg(c); return s; }));
ipcMain.handle('relay:stop', wrap(() => relay.stop()));
ipcMain.handle('relay:regenerate', wrap(() => { const s = relay.regenerate(); const c = comfyCfg(); c.relayToken = s.token; saveCfg(c); return s; }));

app.whenReady().then(() => {
  // file:// 페이지에서 AI 회사 API를 부를 수 있도록 응답에 CORS 허용 헤더를 붙인다 (AI 키 기능용)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    try {
      const host = new URL(details.url).hostname;
      if (AI_HOSTS.includes(host)) {
        const h = details.responseHeaders || {};
        for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-')) delete h[k];
        h['Access-Control-Allow-Origin'] = ['*'];
        h['Access-Control-Allow-Headers'] = ['*'];
        h['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
        return cb({ responseHeaders: h, statusLine: details.method === 'OPTIONS' ? 'HTTP/1.1 200 OK' : details.statusLine });
      }
    } catch (e) { /* ignore */ }
    cb({ responseHeaders: details.responseHeaders });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
