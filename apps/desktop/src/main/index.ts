import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HealthInfo } from '@studio/shared'
import { CHAT_EVENT_CHANNEL } from '@studio/shared'
import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { registerIpcHandlers } from './ipc.js'
import { createServices, type StudioServices } from './services.js'
import { createStudioWindow } from './window.js'

const mainDir = dirname(fileURLToPath(import.meta.url))

let services: StudioServices | undefined
const chatEventTargets = new Set<WebContents>()

function healthInfo(): HealthInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node ?? 'unknown',
    timestamp: new Date().toISOString(),
  }
}

function preloadPath(): string {
  return join(mainDir, '../preload/index.cjs')
}

function loadRenderer(win: BrowserWindow): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && !process.env.STUDIO_SMOKE) {
    win.loadURL(devUrl)
    return
  }
  win.loadFile(join(mainDir, '../renderer/index.html'))
}

async function pickFolder(): Promise<string | null> {
  const focused = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = focused
    ? await dialog.showOpenDialog(focused, options)
    : await dialog.showOpenDialog(options)
  const first = result.filePaths[0]
  return first === undefined ? null : first
}

function broadcastChatEvent(event: unknown): void {
  for (const contents of chatEventTargets) {
    if (!contents.isDestroyed()) {
      contents.send(CHAT_EVENT_CHANNEL, event)
    }
  }
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'window') {
    chatEventTargets.add(contents)
    contents.on('destroyed', () => chatEventTargets.delete(contents))
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(() => {
  services = createServices(app.getPath('userData'), broadcastChatEvent)

  registerIpcHandlers(ipcMain, { health: healthInfo, pickFolder, services })

  const win = createStudioWindow(preloadPath())
  loadRenderer(win)

  if (process.env.STUDIO_SMOKE) {
    // Automated boot verification: quit cleanly once the window is up.
    win.once('ready-to-show', () => {
      setImmediate(() => app.exit(0))
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createStudioWindow(preloadPath())
      loadRenderer(reopened)
    }
  })
})

app.on('will-quit', () => {
  services?.runtime.dispose().catch(() => {})
  services?.db.close()
})
