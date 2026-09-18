import { BrowserWindow } from 'electron'
import { buildWindowOptions } from './window-options.js'

export function createStudioWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow(buildWindowOptions(preloadPath))

  win.once('ready-to-show', () => win.show())

  // The renderer is a local bundle; never allow it to navigate away.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return win
}

export function isAllowedRendererUrl(url: string): boolean {
  if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
    return true
  }
  return url.startsWith('file://')
}
