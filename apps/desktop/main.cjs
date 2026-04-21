const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

const GPMS_WEB_URL = process.env.GPMS_WEB_URL || process.env.ELECTRON_RENDERER_URL || "";

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#020B2D",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (GPMS_WEB_URL) {
    win.loadURL(GPMS_WEB_URL);
    return;
  }

  const distIndexPath = path.resolve(__dirname, "..", "web-modern", "dist", "index.html");
  if (fs.existsSync(distIndexPath)) {
    win.loadFile(distIndexPath);
    return;
  }

  win.loadURL("data:text/html,<h3>GPMS Desktop: renderer not found. Set GPMS_WEB_URL or build apps/web-modern.</h3>");
}

function isHttpReference(reference) {
  return /^https?:\/\//i.test(reference);
}

function isSmbReference(reference) {
  return /^smb:\/\//i.test(reference);
}

function isFileReference(reference) {
  return /^file:\/\//i.test(reference);
}

function isUncReference(reference) {
  return /^\\\\[^\\]+\\[^\\]+/i.test(reference);
}

function isAbsolutePath(reference) {
  return /^[a-zA-Z]:[\\/]/.test(reference) || /^\//.test(reference);
}

function normalizeLocalPath(reference) {
  if (isFileReference(reference)) {
    return fileURLToPath(reference);
  }
  return reference;
}

ipcMain.handle("desktop:pick-original-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Select original file",
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const selectedPath = result.filePaths[0];
  const parsed = path.parse(selectedPath);

  return {
    path: selectedPath,
    name: parsed.base,
    ext: parsed.ext ? parsed.ext.toLowerCase() : null,
  };
});

ipcMain.handle("desktop:open-original-file", async (_event, rawReference) => {
  const reference = String(rawReference ?? "").trim();
  if (!reference) {
    return { ok: false, error: "Original reference is empty." };
  }

  try {
    if (isHttpReference(reference) || isSmbReference(reference)) {
      await shell.openExternal(reference);
      return { ok: true };
    }

    if (isFileReference(reference) || isUncReference(reference) || isAbsolutePath(reference)) {
      const localPath = normalizeLocalPath(reference);
      const openError = await shell.openPath(localPath);
      if (openError) {
        return { ok: false, error: openError };
      }
      return { ok: true };
    }

    return { ok: false, error: "Unsupported original reference format." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open original file reference.";
    return { ok: false, error: message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
