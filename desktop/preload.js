// 웹 화면(index.html)에 PC 전용 기능을 안전하게 노출한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('houseColorDesktop', {
  chatgptStatus: () => ipcRenderer.invoke('siwc:status'),
  chatgptSignIn: () => ipcRenderer.invoke('siwc:signIn'),
  chatgptSignOut: () => ipcRenderer.invoke('siwc:signOut'),
  chatgptModels: () => ipcRenderer.invoke('siwc:models'),
  chatgptAsk: (prompt, imageB64, model) => ipcRenderer.invoke('siwc:ask', prompt, imageB64, model),
});
