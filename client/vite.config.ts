import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = process.env.SERVER_URL ?? 'http://localhost:8080'

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		proxy: {
			'/api': server,
			'/collab': { target: server.replace(/^http/, 'ws'), ws: true },
		},
	},
})
