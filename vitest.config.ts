import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the Cloudflare plugin doesn't start a dev server under Vitest
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
})
