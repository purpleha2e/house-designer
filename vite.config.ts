import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const useHttps = process.env.VITE_HTTPS === '1'
const localCertDir = resolve(import.meta.dirname, '.local-certs')
const localPfx = resolve(localCertDir, 'localhost.pfx')
const localCert = resolve(localCertDir, 'localhost-cert.pem')
const localKey = resolve(localCertDir, 'localhost-key.pem')
const assetPortalTarget = process.env.ASSET_PORTAL_TARGET ?? 'http://localhost:5174'

const serverProxy = {
  '/api/portal': assetPortalTarget,
  '/manufacturer-assets': assetPortalTarget,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: useHttps
    ? {
        https: existsSync(localPfx)
          ? { pfx: readFileSync(localPfx) }
          : {
              cert: readFileSync(localCert),
              key: readFileSync(localKey),
            },
        proxy: serverProxy,
      }
    : {
        proxy: serverProxy,
      },
})
