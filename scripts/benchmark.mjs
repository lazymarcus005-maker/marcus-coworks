#!/usr/bin/env node
/**
 * Performance baseline harness (P5.6): measures SQLite throughput, SSE
 * parse rate, JSON config round-trips, and event fan-out — the app's
 * hot paths that are measurable without a GUI session.
 * Writes docs/performance-baselines.md with the run's numbers.
 */
import { performance } from 'node:perf_hooks'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function record(name, value, unit) {
  results.push({ name, value, unit })
  console.log(`${name}: ${value} ${unit}`)
}

// --- SQLite write throughput ---
{
  const dir = mkdtempSync(join(tmpdir(), 'bench-'))
  const db = new DatabaseSync(join(dir, 'bench.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE events (id TEXT PRIMARY KEY, type TEXT, message TEXT, created_at TEXT)')
  const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
  const start = performance.now()
  for (let index = 0; index < 10_000; index += 1) {
    insert.run(`id-${index}`, 'bench.type', `message ${index}`, new Date().toISOString())
  }
  const elapsed = performance.now() - start
  record('sqlite 10k activity inserts', Math.round(elapsed), 'ms')
  record('sqlite insert rate', Math.round(10_000 / (elapsed / 1000)), 'rows/s')

  const queryStart = performance.now()
  for (let index = 0; index < 100; index += 1) {
    db.prepare("SELECT * FROM events WHERE type = 'bench.type' LIMIT 200").all()
  }
  record('sqlite 200-row query x100', Math.round(performance.now() - queryStart), 'ms')
  db.close()
  rmSync(dir, { recursive: true, force: true })
}

// --- SSE data-line parse rate (mirrors adapter parsing) ---
{
  const chunk = 'data: {"type":"message.part.updated","properties":{"part":{"type":"text","text":"x".repeat(200)}}}\n\n'.repeat(50)
  let count = 0
  const start = performance.now()
  const deadline = start + 1000
  while (performance.now() < deadline) {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data:')) count += 1
    }
  }
  record('sse line parse throughput', Math.round(count), 'lines/s')
}

// --- JSON config round-trip (project opencode.json read-modify-write) ---
{
  const doc = { theme: 'dark', mcp: {}, agent: {} }
  for (let index = 0; index < 20; index += 1) {
    doc.mcp[`server-${index}`] = { type: 'local', command: ['uvx', `tool-${index}`], enabled: true }
  }
  const start = performance.now()
  for (let index = 0; index < 10_000; index += 1) {
    const parsed = JSON.parse(JSON.stringify(doc))
    parsed.mcp['server-0'].enabled = !parsed.mcp['server-0'].enabled
  }
  record('json config round-trip x10k', Math.round(performance.now() - start), 'ms')
}

// --- Event fan-out (runtime → N listeners) ---
{
  const listeners = Array.from({ length: 50 }, () => ({ calls: 0 }))
  const start = performance.now()
  for (let round = 0; round < 10_000; round += 1) {
    for (const listener of listeners) {
      listener.calls += 1
    }
  }
  record('event fan-out 10k x 50 listeners', Math.round(performance.now() - start), 'ms')
}

// --- Report ---
const doc = [
  '# Performance Baselines',
  '',
  `Generated ${new Date().toISOString()} on ${process.platform}/${process.arch}, Node ${process.version}.`,
  '',
  '| Metric | Value | Unit |',
  '|---|---|---|',
  ...results.map((entry) => `| ${entry.name} | ${entry.value} | ${entry.unit} |`),
  '',
  '## Method notes',
  '',
  '- SQLite numbers use node:sqlite with WAL, mirroring the persistence layer.',
  '- SSE parsing mirrors the adapter data-line parser over realistic payloads.',
  '- GUI-side numbers (Electron memory, PTY latency) require a display session;',
  '  run `npm run bench` again on a target machine to compare.',
].join('\n')

const docsDir = join(root, 'docs')
mkdirSync(docsDir, { recursive: true })
writeFileSync(join(docsDir, 'performance-baselines.md'), `${doc}\n`)
console.log('\nwritten: docs/performance-baselines.md')
