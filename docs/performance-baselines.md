# Performance Baselines

Generated 2026-09-19T18:00:42.284Z on darwin/arm64, Node v26.8.1.

| Metric | Value | Unit |
|---|---|---|
| sqlite 10k activity inserts | 295 | ms |
| sqlite insert rate | 33920 | rows/s |
| sqlite 200-row query x100 | 7 | ms |
| sse line parse throughput | 33892700 | lines/s |
| json config round-trip x10k | 60 | ms |
| event fan-out 10k x 50 listeners | 2 | ms |

## Method notes

- SQLite numbers use node:sqlite with WAL, mirroring the persistence layer.
- SSE parsing mirrors the adapter data-line parser over realistic payloads.
- GUI-side numbers (Electron memory, PTY latency) require a display session;
  run `npm run bench` again on a target machine to compare.
