import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The site is served from https://reddy-hari.github.io/btc-ledger/,
// so every asset URL needs the /btc-ledger/ prefix.
export default defineConfig({
  base: '/btc-ledger/',
  plugins: [react()],
})
