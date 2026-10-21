import { cloudflare } from '@cloudflare/vite-plugin'
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const base = '/all-thumbs'

export default defineConfig(({ command, isPreview }) => ({
	base,
	plugins: [
		cloudflare({
			/* eslint-disable ts/naming-convention -- Cloudflare's configuration requires these property names. */
			config: {
				assets: {
					// Development serves source files; builds use a physical subdirectory.
					...(command === 'serve' && !isPreview && { base_path: base }),
					html_handling: 'drop-trailing-slash',
					not_found_handling: 'none',
				},
				compatibility_date: '2026-10-11',
				name: 'all-thumbs',
				observability: { enabled: true },
				preview_urls: false,
				routes: [
					{ pattern: `frontiernerds.com${base}`, zone_name: 'frontiernerds.com' },
					{ pattern: `frontiernerds.com${base}/*`, zone_name: 'frontiernerds.com' },
					// Legacy path, redirected to the base by public/_redirects
					{ pattern: 'frontiernerds.com/48x48', zone_name: 'frontiernerds.com' },
					{ pattern: 'frontiernerds.com/48x48/*', zone_name: 'frontiernerds.com' },
				],
				workers_dev: false,
			},
			/* eslint-enable ts/naming-convention */
		}),
		// Svelte options live here instead of in a svelte.config.js
		svelte({ configFile: false, preprocess: vitePreprocess() }),
	],
	server: {
		open: process.env.CI === undefined,
	},
}))
