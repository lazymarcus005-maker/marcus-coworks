#!/usr/bin/env node
/**
 * Restores the exec bit on node-pty's prebuilt spawn-helper. npm's
 * tar extraction can strip permissions, and a non-executable
 * spawn-helper makes every pty.spawn fail with posix_spawnp.
 */
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const candidates = [
  join('node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  join('node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
]

for (const target of candidates) {
  if (existsSync(target)) {
    try {
      chmodSync(target, 0o755)
      console.log(`[prepare-native] exec bit ensured: ${target}`)
    } catch (cause) {
      console.warn(`[prepare-native] could not chmod ${target}: ${String(cause)}`)
    }
  }
}
