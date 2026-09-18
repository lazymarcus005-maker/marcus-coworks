import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Pure factory for the studio window's security-relevant options.
 *
 * Kept free of any runtime `electron` import so it can be unit-tested in
 * plain Node. The spec's renderer security defaults live here:
 * contextIsolation on, nodeIntegration off, sandbox on, webSecurity on.
 */
export function buildWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    backgroundColor: '#1e1e24',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !process.env.STUDIO_SMOKE,
    },
  }
}
