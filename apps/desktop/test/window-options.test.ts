import { describe, expect, it } from 'vitest'
import { buildWindowOptions } from '../src/main/window-options.js'

describe('window security defaults', () => {
  const options = buildWindowOptions('/fake/preload.cjs')

  it('enables contextIsolation', () => {
    expect(options.webPreferences?.contextIsolation).toBe(true)
  })

  it('disables nodeIntegration', () => {
    expect(options.webPreferences?.nodeIntegration).toBeFalsy()
  })

  it('enables the renderer sandbox', () => {
    expect(options.webPreferences?.sandbox).toBe(true)
  })

  it('keeps webSecurity on', () => {
    expect(options.webPreferences?.webSecurity).not.toBe(false)
  })

  it('loads the typed preload bridge', () => {
    expect(options.webPreferences?.preload).toBe('/fake/preload.cjs')
  })
})
