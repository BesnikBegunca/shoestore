// electron/main.cjs
const { app, BrowserWindow } = require("electron");
const path = require("path");
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0B0D14",
    show: false,
  });

  win.once("ready-to-show", () => win.show());

  if (isDev) {
    // DEV (opsionale) - nëse don me testu shpejt
    win.loadURL("http://localhost:8081");
  } else {
    // PROD - hap web build-in lokal
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    win.loadFile(indexPath);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
