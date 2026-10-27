import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// L'interface compilée est écrite dans ../static, servie par server.py.
// En développement (npm run dev), les appels /api sont redirigés vers le serveur Python.
export default defineConfig({
  plugins: [react()],
  // Chemins relatifs : l'interface fonctionne aussi sous un préfixe (Ingress de Home Assistant).
  base: './',
  build: { outDir: '../static', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
})
