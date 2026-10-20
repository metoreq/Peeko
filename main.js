const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage, shell, dialog } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), { pathToFileURL } = require('url');
const { execFile } = require('child_process');

// Low GPU use: software compositing. The occlusion switch stops Chromium freezing the overlay behind games.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.setAppUserModelId('com.metoreq.peeko');

// ---- logging: a startup crash can never be silent again (see %APPDATA%\Peeko\log.txt) ----
function log(...a) { try { fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.appendFileSync(path.join(app.getPath('userData'), 'log.txt'), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch {} }
let shown = false;
process.on('uncaughtException', e => { log('uncaught', (e && e.stack) || e);
  if (!shown) { shown = true; try { dialog.showErrorBox('Peeko error', String((e && e.stack) || e)); } catch {} } });
process.on('unhandledRejection', e => log('rejection', (e && e.stack) || e));
app.on('render-process-gone', (e, wc, d) => log('renderer gone:', d.reason));
app.on('child-process-gone', (e, d) => log('child gone:', d.type, d.reason));

const LOCK = app.requestSingleInstanceLock();
if (!LOCK) { log('another instance is already running, exiting'); app.quit(); }

const MAX = 6, ICON = path.join(__dirname, 'assets', 'icon.png'), pre = path.join(__dirname, 'preload.js');
const pkg = require('./package.json');
const author = typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name) || 'unknown';
const OD = { enabled: true, skin: '', display: 0, corner: 'bottom-right', x: 0, y: 0, height: 360,
             margin: 24, opacity: 100, flip: false, move: false };
const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const CF = () => path.join(app.getPath('userData'), 'settings.json');
const LEGACY = path.join(app.getPath('appData'), 'Anima Lite', 'settings.json'); // settings from before the rename
const SRC = fs.existsSync(CF()) ? CF() : fs.existsSync(LEGACY) ? LEGACY : null;
const FIRST = !SRC; // true only the very first launch
let S = { hidden: false, openSettings: false, startup: false, keepTop: true, nextId: 2, overlays: [{ id: 1, ...OD }] };
try { // also migrates the older single-overlay settings file
  const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const raw = Array.isArray(j.overlays) ? j.overlays : [j];
  const list = raw.slice(0, MAX).map((o, i) => { const n = { ...OD, id: o.id || i + 1 }; for (const k in OD) if (k in o) n[k] = o[k]; return n; });
  if (list.length) S = { hidden: false, openSettings: !!j.openSettings, startup: !!j.startup, keepTop: j.keepTop !== false, overlays: list,
                         nextId: Math.max(...list.map(o => o.id)) + 1 };
} catch {}
let tmr; const save = () => { clearTimeout(tmr); tmr = setTimeout(() => { try { fs.writeFileSync(CF(), JSON.stringify(S)); } catch {} }, 300); };
const find = id => S.overlays.find(o => o.id === id);
if (SRC === LEGACY) save();

// ---- skins live next to the exe (portable builds unpack to a temp dir, so that one can't be used) ----
let SK = '';
function skinsDir() {
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'skins') : path.join(__dirname, 'skins');
  const base = app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : __dirname;
  const beside = path.join(base, 'skins'), inData = path.join(app.getPath('userData'), 'skins');
  // portable/dev: next to the exe; installed: %APPDATA%\Peeko\skins (the install folder is replaced on update/uninstall)
  const order = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR ? [inData, beside] : [beside, inData];
  for (const d of order) {
    try {
      fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK);
      if (d !== bundled && !fs.readdirSync(d).length && fs.existsSync(bundled))
        for (const f of fs.readdirSync(bundled)) fs.copyFileSync(path.join(bundled, f), path.join(d, f));
      return d;
    } catch (e) { log('skins dir unusable', d, e.message); }
  }
  return bundled;
}
const skins = () => { try {
  return fs.readdirSync(SK).filter(f => /\.(gif|webp|png|apng|webm|mp4)$/i.test(f)).sort()
    .map(f => ({ name: f, file: path.join(SK, f), video: /\.(webm|mp4)$/i.test(f) }));
} catch { return []; } };
const state = () => ({ err: startupErr, g: { hidden: S.hidden, openSettings: S.openSettings, startup: S.startup, keepTop: S.keepTop }, overlays: S.overlays, max: MAX,
  skins: skins().map(s => s.name), about: `${pkg.name} v${pkg.version} - by ${author}`,
  displays: screen.getAllDisplays().map((d, i) => `Display ${i + 1} (${d.bounds.width}x${d.bounds.height})`) });

// ---- start with Windows ----
// Two things broke the old login-item: (1) portable exes run from a temp copy, so the saved path died;
// (2) Windows silently skips administrator apps in the normal Run key. A Task Scheduler logon task
// pointing at the real exe, run with highest privileges and no battery/time-limit rules, fixes both.
const TASK = 'Peeko';
let startupErr = '';
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function taskXml(exe, user, who) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>${esc(who)}</Author></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId><Delay>PT5S</Delay></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(exe)}</Command><Arguments>--hidden</Arguments><WorkingDirectory>${esc(path.dirname(exe))}</WorkingDirectory></Exec></Actions>
</Task>`;
}
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true },
  (e, so, se) => e ? rej(new Error(String(se || so || e.message).trim())) : res()));
async function setStartup(on) { // resolves true if the setting could be applied
  startupErr = '';
  if (!app.isPackaged) { if (on) startupErr = 'Start with system only works in the built exe, not with npm start.'; return !on; }
  const exe = exePath();
  if (process.platform === 'win32') {
    try {
      if (on) {
        const f = path.join(os.tmpdir(), 'peeko-task.xml');
        const xml = taskXml(exe, `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`, author);
        fs.writeFileSync(f, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xml, 'utf16le')]));
        try { await run('schtasks', ['/create', '/tn', TASK, '/xml', f, '/f']); } finally { try { fs.unlinkSync(f); } catch {} }
      } else await run('schtasks', ['/delete', '/tn', TASK, '/f']).catch(e => log('schtasks delete:', e.message));
      app.setLoginItemSettings({ openAtLogin: false, path: exe, name: TASK }); // remove any old Run-key entry
      return true;
    } catch (e) { log('schtasks failed:', e.message); }
  }
  app.setLoginItemSettings({ openAtLogin: on, path: exe, args: ['--hidden'], name: TASK });
  if (on && process.platform === 'win32') startupErr = 'Task Scheduler failed, so the basic startup entry was used. That cannot launch an administrator build. Details are in log.txt.';
  return true;
}

// ---- overlays: one small transparent window each ----
const W = new Map(); // id -> { win, ready, cur, nat }
let ctl = null, tray = null;
const push = () => { if (ctl && !ctl.isDestroyed()) ctl.webContents.send('state', state()); };

function place(o) {
  const r = W.get(o.id); if (!r || !r.nat || r.win.isDestroyed()) return;
  const b = (screen.getAllDisplays()[o.display] || screen.getPrimaryDisplay()).bounds;
  const h = Math.min(o.height, b.height), w = Math.min(Math.round(h * r.nat.w / r.nat.h), b.width), m = o.margin;
  let x, y;
  if (o.corner === 'custom') { x = o.x; y = o.y; }
  else { x = o.corner.endsWith('left') ? b.x + m : b.x + b.width - w - m; y = o.corner.startsWith('top') ? b.y + m : b.y + b.height - h - m; }
  r.win.setBounds({ x, y, width: w, height: h });
  r.win.showInactive();
  r.win.setSkipTaskbar(true); // showing a window can re-add its taskbar button
  r.win.setAlwaysOnTop(true, 'screen-saver');
}

function mkOv(o) {
  const win = new BrowserWindow({ width: 200, height: 200, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: true,
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}), // tool window: never gets a taskbar button or Alt-Tab entry
    webPreferences: { preload: pre, backgroundThrottling: false } });
  const r = { win, ready: false, cur: '', nat: null }; W.set(o.id, r);
  win.setIgnoreMouseEvents(true);
  win.setSkipTaskbar(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'overlay.html'));
  win.webContents.once('did-finish-load', () => { r.ready = true; const c = find(o.id); if (c) applyOv(c); });
  win.on('moved', () => { const c = find(o.id); if (!c || !c.move) return; const b = win.getBounds();
    c.corner = 'custom'; c.x = b.x; c.y = b.y; save(); push(); });
  win.on('closed', () => { if (W.get(o.id) === r) W.delete(o.id); });
}

function applyOv(o) {
  const l = skins(), sk = l.find(s => s.name === o.skin) || l[0];
  const r = W.get(o.id);
  if (!o.enabled || !sk) { if (r) { W.delete(o.id); if (!r.win.isDestroyed()) r.win.destroy(); } return; } // disabled = window freed
  if (S.hidden) { if (r && !r.win.isDestroyed()) r.win.hide(); return; }
  if (!r) { mkOv(o); return; }
  if (!r.ready || r.win.isDestroyed()) return;
  r.win.setIgnoreMouseEvents(!o.move);
  r.win.setFocusable(o.move);
  r.win.setSkipTaskbar(true);
  r.win.webContents.send('cfg', { opacity: o.opacity / 100, flip: o.flip, move: o.move });
  if (r.cur !== sk.name) { r.cur = sk.name; r.nat = null; r.win.webContents.send('skin', { url: pathToFileURL(sk.file).href, video: sk.video }); }
  else place(o);
}
function applyAll() {
  for (const [id, r] of W) if (!find(id)) { W.delete(id); if (!r.win.isDestroyed()) r.win.destroy(); }
  S.overlays.forEach(applyOv);
}

function openCtl() {
  if (ctl && !ctl.isDestroyed()) { ctl.show(); ctl.focus(); return; }
  ctl = new BrowserWindow({ width: 420, height: 700, title: 'Peeko', icon: ICON, backgroundColor: '#14161d', webPreferences: { preload: pre } });
  ctl.removeMenu();
  ctl.loadFile(path.join(__dirname, 'control.html'));
  ctl.on('closed', () => { ctl = null; }); // closing frees its memory; overlays keep running
}
function toggle() { S.hidden = !S.hidden; save(); applyAll(); push(); }

ipcMain.on('size', (e, n) => { for (const [id, r] of W) if (!r.win.isDestroyed() && r.win.webContents.id === e.sender.id) { r.nat = n; const o = find(id); if (o) place(o); } });
ipcMain.handle('get', () => state());
ipcMain.handle('set', async (e, p) => {
  for (const k of ['hidden', 'openSettings', 'startup', 'keepTop']) if (k in p) S[k] = !!p[k];
  if ('startup' in p && !(await setStartup(S.startup))) S.startup = false;
  save(); applyAll(); return state();
});
ipcMain.handle('setOv', (e, id, p) => { const o = find(id); if (o) { for (const k in p) if (k in OD && k !== 'x' && k !== 'y') o[k] = p[k]; save(); applyOv(o); } return state(); });
ipcMain.handle('addOv', () => {
  if (S.overlays.length < MAX) { S.overlays.push({ ...OD, corner: CORNERS[S.overlays.length % 4], id: S.nextId++ }); save(); applyAll(); }
  return state();
});
ipcMain.handle('delOv', (e, id) => { if (S.overlays.length > 1) { S.overlays = S.overlays.filter(o => o.id !== id); save(); applyAll(); } return state(); });
ipcMain.handle('act', (e, a) => { if (a === 'folder') shell.openPath(SK); if (a === 'quit') app.quit(); return state(); });

app.on('second-instance', () => { if (app.isReady()) openCtl(); });
app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());
if (LOCK) app.whenReady().then(() => {
  SK = skinsDir(); log('started, skins:', SK);
  try { tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 })); tray.setToolTip('Peeko');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Settings', click: openCtl },
      { label: 'Show / hide all overlays (Ctrl+Alt+H)', click: toggle }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
    tray.on('click', openCtl); } catch (e) { log('tray failed', e.message); }
  globalShortcut.register('CommandOrControl+Alt+H', toggle);
  screen.on('display-metrics-changed', () => S.overlays.forEach(place));
  // Fullscreen games push other windows down; re-assert top-most cheaply every 1.5 s.
  setInterval(() => { if (!S.keepTop || S.hidden) return;
    for (const r of W.values()) if (!r.win.isDestroyed() && r.win.isVisible()) { r.win.setAlwaysOnTop(true, 'screen-saver', 1); r.win.moveTop(); } }, 1500);
  applyAll();
  if (SRC === LEGACY) run('schtasks', ['/delete', '/tn', 'Anima Lite', '/f']).catch(() => {}); // old startup task
  if (S.startup) setStartup(true).then(() => push()); // keeps the task pointing at the exe if it was moved
  // Settings stay in the tray on launch (and always on autostart). They open on the very first run, when
  // 'Open settings window on launch' is on, or when there is nothing to show; otherwise via the tray icon.
  const anyShown = S.overlays.some(o => o.enabled) && skins().length > 0;
  if (!anyShown || (!process.argv.includes('--hidden') && (S.openSettings || FIRST))) openCtl();
}).catch(e => { log('startup failed', (e && e.stack) || e); dialog.showErrorBox('Peeko failed to start', String((e && e.stack) || e)); });
