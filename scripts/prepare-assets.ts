import { mkdir, readdir, rename } from 'node:fs/promises'

const output = new URL('../dist/', import.meta.url)
const destination = new URL('all-thumbs/', output)
// Wrangler still deploys from dist, so URL paths match the nested file layout.
const deploymentFiles = new Set(['.assetsignore', '.dev.vars', 'all-thumbs', 'wrangler.json'])

await mkdir(destination, { recursive: true })
const names = await readdir(output)
for (const name of names) {
	if (!deploymentFiles.has(name)) {
		await rename(new URL(name, output), new URL(name, destination))
	}
}
