import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const workspace = import.meta.dirname

// A separate entry means opening a published house never mounts App/the editor.
// Relative asset URLs let the same viewer package live at any house's URL.
export default defineConfig({
  root: resolve(workspace, 'viewer'),
  base: './',
  plugins: [react()],
  publicDir: resolve(workspace, '.viewer-data/public'),
  build: { outDir: resolve(workspace, 'dist-viewer'), emptyOutDir: true },
  server: { fs: { allow: [workspace] } },
})
