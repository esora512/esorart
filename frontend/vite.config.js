import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' lets the build work under any GitHub Pages path (e.g. /esorart/)
export default defineConfig({ base: './', plugins: [react()] })
