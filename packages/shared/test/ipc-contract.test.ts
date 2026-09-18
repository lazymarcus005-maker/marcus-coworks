import { describe, expect, it } from 'vitest'
import { ipcChannels } from '../src/index.js'

describe('ipc contract', () => {
  it('exposes channels without duplicates', () => {
    const channels = ipcChannels()
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('uses namespace/channel naming', () => {
    for (const channel of ipcChannels()) {
      expect(channel).toMatch(/^[a-z][a-zA-Z]*\/[a-z][a-zA-Z]*$/)
    }
  })
})
