'use strict';

const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  powerMonitor,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config — persisted next to the app so the user can tweak it.
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(app.getPath('userData'), 'otto-config.json');

const DEFAULT_CONFIG = {
  // How many hours of "away" before Otto greets you again on wake/unlock.
  resurfaceAfterHours: 3,
  // Seconds of inactivity that count as "away" for the active-again check.
  idleAwaySeconds: 60 * 20,
  // How far Otto sits from the right edge of the taskbar, in px. This clears
  // the system tray / clock so Otto lands just past the rightmost app icon.
  // Nudge this up/down if it doesn't line up on your taskbar.
  trayClearancePx: 200,
};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

let config = loadConfig();
let lastSurfacedAt = 0; // epoch ms of the last priorities popup

// ---------------------------------------------------------------------------
// Geometry — the pet hugs the taskbar; the panel floats just above it.
// ---------------------------------------------------------------------------
const PET = { w: 64, h: 60 }; // small — Otto sits like one more taskbar icon
// The panel window is larger than the visible card on purpose: SHADOW_PAD of
// transparent space around it gives the soft drop-shadow room so it never
// gets clipped at the window edge. Keep SHADOW_PAD in sync with the CSS inset
// in panel.html.
const SHADOW_PAD = 32;
const CARD = { w: 384, h: 360 }; // visible card (slightly smaller than before)
const PANEL = { w: CARD.w + SHADOW_PAD * 2, h: CARD.h + SHADOW_PAD * 2 };
const FEET_GAP = 3; // how far Otto's feet sit above the screen's bottom edge

function primary() {
  return screen.getPrimaryDisplay();
}

// Height of a bottom taskbar (0 if it's on a side / auto-hidden).
function taskbarHeight(d) {
  const b = d.bounds;
  const wa = d.workArea;
  const bottomBar = b.y + b.height - (wa.y + wa.height);
  return bottomBar > 0 ? bottomBar : 0;
}

function petBounds() {
  // Anchor to the FULL display bounds (which include the taskbar) and sit Otto
  // right on the bar, near the right end of the app icons — just left of the
  // system tray. main keeps the window above the taskbar via z-order.
  const d = primary();
  const b = d.bounds;
  const x = b.x + b.width - config.trayClearancePx - PET.w;
  const y = b.y + b.height - PET.h - FEET_GAP;
  return {
    x: Math.round(Math.max(b.x, x)),
    y: Math.round(y),
    width: PET.w,
    height: PET.h,
  };
}

function panelBounds() {
  // Float the card just above the taskbar, with its right edge lined up over
  // Otto. We position the WINDOW, then account for SHADOW_PAD so the visible
  // card (not the transparent shadow margin) is what lands where we want.
  const d = primary();
  const wa = d.workArea;
  const pet = petBounds();

  // Card right edge ≈ Otto's right edge.
  const cardRight = pet.x + PET.w;
  let x = cardRight - (PANEL.w - SHADOW_PAD);

  // Card bottom edge ≈ just above the taskbar.
  const cardBottom = wa.y + wa.height - 8;
  let y = cardBottom - (PANEL.h - SHADOW_PAD);

  // Clamp inside the work area so the card stays fully on-screen.
  x = Math.min(Math.max(x, wa.x + 8 - SHADOW_PAD), wa.x + wa.width - PANEL.w + SHADOW_PAD - 8);
  y = Math.max(y, wa.y + 8 - SHADOW_PAD);

  return { x: Math.round(x), y: Math.round(y), width: PANEL.w, height: PANEL.h };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
let petWin = null;
let panelWin = null;
let tray = null;

function createPetWindow() {
  const b = petBounds();
  petWin = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    focusable: false, // never steals focus from whatever you're doing
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Float above fullscreen apps and other always-on-top windows.
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadFile(path.join(__dirname, 'pet.html'));

  // The Windows taskbar is itself a topmost window and will paint over Otto
  // unless we keep re-asserting our place above it. A light periodic nudge
  // keeps him sitting *on* the bar rather than behind it.
  keepOnTop();
}

let keepTimer = null;
function keepOnTop() {
  if (keepTimer) clearInterval(keepTimer);
  keepTimer = setInterval(() => {
    if (petWin && !petWin.isDestroyed()) {
      petWin.setAlwaysOnTop(true, 'screen-saver');
      petWin.moveTop();
    }
  }, 2000);
}

function createPanelWindow() {
  const b = panelBounds();
  panelWin = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWin.loadFile(path.join(__dirname, 'panel.html'));

  // Dismiss when the user clicks away.
  panelWin.on('blur', () => hidePanel());
}

// ---------------------------------------------------------------------------
// Panel show / hide
// ---------------------------------------------------------------------------
function showPanel(reason = 'manual') {
  if (!panelWin) return;
  panelWin.setBounds(panelBounds());
  panelWin.showInactive();
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.focus(); // so click-away (blur) works
  panelWin.webContents.send('panel:show', {
    reason,
    greeting: timeGreeting(),
    dateLabel: dateLabel(),
  });
  if (petWin) petWin.webContents.send('pet:state', 'happy');
  lastSurfacedAt = Date.now();
}

function hidePanel() {
  if (panelWin && panelWin.isVisible()) {
    panelWin.webContents.send('panel:hide');
    // give the CSS exit animation a beat before actually hiding
    setTimeout(() => panelWin && panelWin.hide(), 180);
  }
  if (petWin) petWin.webContents.send('pet:state', 'idle');
}

function togglePanel() {
  if (panelWin && panelWin.isVisible()) hidePanel();
  else showPanel('manual');
}

// ---------------------------------------------------------------------------
// "Surface when I come back after a few hours"
// ---------------------------------------------------------------------------
function maybeSurfaceOnReturn(reason) {
  const hours = (Date.now() - lastSurfacedAt) / 36e5;
  if (hours >= config.resurfaceAfterHours) {
    showPanel(reason);
  }
}

function wireTriggers() {
  // Laptop opened / woken from sleep.
  powerMonitor.on('resume', () => maybeSurfaceOnReturn('resume'));
  // Returned to the machine and unlocked it.
  powerMonitor.on('unlock-screen', () => maybeSurfaceOnReturn('unlock'));

  // Catch the "came back to an idle machine" case that doesn't fire a
  // lock/sleep event: watch idle time and treat a long-idle -> active
  // transition as a return.
  let wasAway = false;
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime(); // seconds
    if (idle >= config.idleAwaySeconds) {
      wasAway = true;
    } else if (wasAway) {
      wasAway = false;
      maybeSurfaceOnReturn('active-again');
    }
  }, 15 * 1000);
}

// ---------------------------------------------------------------------------
// Tray — the seam where the user controls Otto.
// ---------------------------------------------------------------------------
function buildTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'sprites', 'f11.png'))
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Otto's Abode");
  refreshTrayMenu();
  tray.on('click', () => togglePanel());
}

function refreshTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Show priorities now', click: () => showPanel('manual') },
    { type: 'separator' },
    {
      label: 'Resurface after…',
      submenu: [1, 2, 3, 4, 6, 8].map((h) => ({
        label: `${h} hour${h > 1 ? 's' : ''} away`,
        type: 'radio',
        checked: config.resurfaceAfterHours === h,
        click: () => {
          config.resurfaceAfterHours = h;
          saveConfig();
          refreshTrayMenu();
        },
      })),
    },
    {
      label: 'Test: simulate coming back now',
      click: () => {
        lastSurfacedAt = 0;
        maybeSurfaceOnReturn('test');
      },
    },
    { type: 'separator' },
    { label: 'Quit Otto', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Date / greeting helpers (the panel header is live, per the design)
// ---------------------------------------------------------------------------
function dateLabel() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('pet:click', () => togglePanel());
ipcMain.on('panel:dismiss', () => hidePanel());

// Keep windows pinned correctly if the display layout changes.
function repositionAll() {
  if (petWin) petWin.setBounds(petBounds());
  if (panelWin && panelWin.isVisible()) panelWin.setBounds(panelBounds());
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel('manual'));

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.otto.abode');
    createPetWindow();
    createPanelWindow();
    buildTray();
    wireTriggers();

    screen.on('display-metrics-changed', repositionAll);
    screen.on('display-added', repositionAll);
    screen.on('display-removed', repositionAll);

    // Otto introduces himself once on first launch.
    setTimeout(() => showPanel('launch'), 900);
  });

  // This is an always-resident companion: closing the panel must not quit it.
  app.on('window-all-closed', (e) => {
    /* no-op: tray keeps it alive */
  });
}
