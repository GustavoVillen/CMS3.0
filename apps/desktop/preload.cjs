const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gpmsDesktop", {
  isDesktop: true,
  chooseOriginalFile: () => ipcRenderer.invoke("desktop:pick-original-file"),
  openOriginalFile: (reference) => ipcRenderer.invoke("desktop:open-original-file", reference),
});
