import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron';
import petImage from './assets/nagisa-idle.png';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const title = '古河渚桌宠';
const size = 256;
const margin = 24;

let petWindow: BrowserWindow;
let tray: Tray;

async function startPet(): Promise<void> {
  const area = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({
    title,
    width: size,
    height: size,
    x: area.x + Math.max(0, area.width - size - margin),
    y: area.y + Math.max(0, area.height - size - margin),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const icon = nativeImage.createFromDataURL(petImage).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip(title);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '退出桌宠', click: () => app.quit() },
  ]));

  await petWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  petWindow.showInactive();
}

app.whenReady().then(startPet).catch((error) => {
  console.error('桌宠启动失败', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => tray?.destroy());
