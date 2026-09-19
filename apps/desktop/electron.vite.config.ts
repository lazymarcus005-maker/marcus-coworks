import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // Native module: must be required at runtime, not bundled.
        external: ['node-pty'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS; keep the .cjs extension so a
        // "type": "module" package does not make Node treat the output as ESM.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [solid()],
  },
})
