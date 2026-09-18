import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HealthInfo } from '@studio/shared'
import { app, BrowserWindow, ipcMain } from 'electron'
import { registerIpcHandlers } from './ipc.js'
import { createStudioWindow } from './window.js'

const mainDir = dirname(fileURLToPath(import.meta.url))

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(() => {
  registerIpcHandlers(ipcMain, { health: healthInfo })

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
