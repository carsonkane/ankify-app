import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // IMPORTANT: This base path must match your exact GitHub repository name
  base: '/ankify-app/', 
  plugins: [
    react(),
    tailwindcss(),
  ],
})
