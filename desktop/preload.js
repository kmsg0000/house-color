// 웹 화면(index.html)에 PC 전용 기능을 안전하게 노출한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('houseColorDesktop', {
  comfyConfig: () => ipcRenderer.invoke('comfy:config'),
  comfySetUrl: url => ipcRenderer.invoke('comfy:setUrl', url),
  comfySetWorkflow: text => ipcRenderer.invoke('comfy:setWorkflow', text),
  comfyTest: () => ipcRenderer.invoke('comfy:test'),
  comfyRun: (imageB64, prompt, megapixels) => ipcRenderer.invoke('comfy:run', imageB64, prompt, megapixels),
  comfySegment: (imageB64, positive, negative, text) => ipcRenderer.invoke('comfy:segment', imageB64, positive, negative, text),
  comfyCancel: () => ipcRenderer.invoke('comfy:cancel'),
  onComfyProgress: cb => { const h = (_e, p) => cb(p); ipcRenderer.on('comfy:progress', h); return () => ipcRenderer.removeListener('comfy:progress', h); },
  relayStatus: () => ipcRenderer.invoke('relay:status'),
  relayStart: () => ipcRenderer.invoke('relay:start'),
  relayStop: () => ipcRenderer.invoke('relay:stop'),
  relayRegenerate: () => ipcRenderer.invoke('relay:regenerate'),
  chatgptStatus: () => ipcRenderer.invoke('siwc:status'),
  chatgptSignIn: () => ipcRenderer.invoke('siwc:signIn'),
  chatgptSignOut: () => ipcRenderer.invoke('siwc:signOut'),
  chatgptModels: () => ipcRenderer.invoke('siwc:models'),
  chatgptEditImage: (imageB64, maskB64, prompt, model) => ipcRenderer.invoke('siwc:edit', imageB64, maskB64, prompt, model),
  chatgptAsk: (prompt, imageB64, model) => ipcRenderer.invoke('siwc:ask', prompt, imageB64, model),
});
