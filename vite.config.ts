import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serving `proposal-templates/` to the browser.
 *
 * The drafter fills the firm's designed HTML in the browser — it parses the
 * template, holds the markup and writes the answers back — so the raw file has
 * to be fetchable at runtime. Two ways were rejected before this one:
 *
 * - `import template from '...?raw'` bundles 3.6MB of base64 images into a JS
 *   chunk, where it is parsed as a string literal on every load.
 * - Copying into `public/` keeps a second copy of that 3.6MB in git, which then
 *   drifts from the one anybody edits.
 *
 * So the folder is served where it already sits: as middleware in dev, as
 * emitted assets in a build. The manifest is computed from the directory rather
 * than written by hand, because a template that is present but unlisted is the
 * same invisible failure the compile step exists to prevent.
 */
const TEMPLATE_DIR = 'proposal-templates'

interface TemplateEntry {
  name: string
  html: string
  config: string | null
}

function manifest(root: string): TemplateEntry[] {
  const dir = path.resolve(root, TEMPLATE_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((file) => /\.html?$/i.test(file))
    .sort()
    .map((file) => {
      const config = `${file.replace(/\.html?$/i, '')}.config.json`
      return {
        name: file.replace(/\.html?$/i, ''),
        html: file,
        config: fs.existsSync(path.join(dir, config)) ? config : null,
      }
    })
}

function proposalTemplates(): Plugin {
  const root = import.meta.dirname
  const prefix = `/${TEMPLATE_DIR}/`
  const indexOf = () => JSON.stringify({ templates: manifest(root) }, null, 2)

  return {
    name: 'proposal-templates',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? '').split('?')[0]
        if (!url.startsWith(prefix)) return next()

        const wanted = decodeURIComponent(url.slice(prefix.length))
        if (wanted === 'index.json') {
          response.setHeader('Content-Type', 'application/json')
          response.end(indexOf())
          return
        }

        // Only files the manifest names. The alternative — resolving whatever
        // was asked for under the folder — is a path-traversal read of the
        // developer's disk served over the dev server's open port.
        const entries = manifest(root)
        const allowed = entries.some(
          (entry) => entry.html === wanted || entry.config === wanted,
        )
        if (!allowed) return next()

        response.setHeader(
          'Content-Type',
          wanted.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8',
        )
        fs.createReadStream(path.resolve(root, TEMPLATE_DIR, wanted)).pipe(response)
      })
    },

    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: `${TEMPLATE_DIR}/index.json`,
        source: indexOf(),
      })
      for (const entry of manifest(root)) {
        for (const file of [entry.html, entry.config]) {
          if (!file) continue
          this.emitFile({
            type: 'asset',
            fileName: `${TEMPLATE_DIR}/${file}`,
            source: fs.readFileSync(path.resolve(root, TEMPLATE_DIR, file)),
          })
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), proposalTemplates()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
