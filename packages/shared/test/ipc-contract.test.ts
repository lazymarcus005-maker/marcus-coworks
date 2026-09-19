import { describe, expect, it } from 'vitest'
import type { IpcChannel } from '../src/index.js'
import { ipcChannels } from '../src/index.js'

/**
 * Compile-time coverage: every channel in the contract must appear here.
 * Adding a channel to IpcContract without registering it in ipcChannels()
 * fails typecheck via this record AND fails the runtime test below.
 */
const COVERAGE: Record<IpcChannel, true> = {
  'app/health': true,
  'projects/list': true,
  'projects/add': true,
  'projects/pick-folder': true,
  'projects/rename': true,
  'projects/remove': true,
  'projects/tabs/state': true,
  'projects/tabs/close': true,
  'projects/tabs/open': true,
  'projects/tabs/activate': true,
  'activity/list': true,
  'providers/list': true,
  'providers/save': true,
  'providers/delete': true,
  'providers/test': true,
  'providers/test-saved': true,
  'chat/start': true,
  'chat/send': true,
  'chat/stop': true,
  'chat/history': true,
  'tasks/state': true,
  'tasks/create-goal': true,
  'goals/update': true,
  'tasks/add': true,
  'tasks/update': true,
  'tasks/cancel': true,
  'tasks/transition': true,
  'tasks/history': true,
  'fs/list': true,
  'terminal/create': true,
  'terminal/write': true,
  'terminal/resize': true,
  'terminal/dispose': true,
  'terminal/list': true,
  'worktrees/list': true,
  'worktrees/create': true,
  'worktrees/status': true,
  'worktrees/diff': true,
  'worktrees/discard': true,
  'locks/list': true,
  'locks/acquire': true,
  'locks/release': true,
}

describe('ipc contract', () => {
  it('exposes channels without duplicates', () => {
    const channels = ipcChannels()
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('uses namespace/channel naming', () => {
    for (const channel of ipcChannels()) {
      expect(channel).toMatch(/^[a-z][a-zA-Z]*\/[a-z][a-zA-Z/-]*$/)
    }
  })

  it('registry covers every contract channel exactly', () => {
    expect([...ipcChannels()].sort()).toEqual(Object.keys(COVERAGE).sort())
  })
})
