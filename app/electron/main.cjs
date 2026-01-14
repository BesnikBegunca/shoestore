// electron/main.cjs
const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0B0D14",
    show: false,
  });

  win.once("ready-to-show", () => win.show());

  if (!app.isPackaged) {
    // DEV
    win.loadURL("http://localhost:8081");
  } else {
    // PROD (hap dist/index.html)
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
