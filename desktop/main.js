// 우리집 외벽 색 바꾸기 — 데스크톱(Windows / Mac) 실행 파일
const { app, BrowserWindow, session, shell, Menu, ipcMain } = require('electron');
const siwc = require('./siwc');
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
const wrap = fn => async (_e, ...args) => { try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: String(err && err.message || err) }; } };
ipcMain.handle('siwc:status', wrap(() => siwc.status()));
ipcMain.handle('siwc:signIn', wrap(() => siwc.signIn()));
ipcMain.handle('siwc:signOut', wrap(() => siwc.signOut()));
ipcMain.handle('siwc:models', wrap(() => siwc.listModels()));
ipcMain.handle('siwc:ask', wrap((p, img, model) => siwc.ask(String(p), String(img), model ? String(model) : '')));

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
