/**
 * Self-contained tsdown build for the standalone execution-graph plugin.
 *
 * This mirrors DeepSeek Harness's in-repo client-bundle preset but carries no
 * monorepo dependency, so a `pnpm install` + `pnpm build` (or the `prepare`
 * script after a git install) produces the same two artifacts a DSH host loads:
 *
 *  - `lib/index.js` — the Node-half loader entry (a no-op `apply` for this
 *    browser-only plugin), plain ESM.
 *  - `lib/client.js` — the browser client bundle wrapped as a closure factory
 *    (`window.__ModuleLoader__.load({ id, factory })`). The host resolves the
 *    externalized platform modules (react, cordis, ui-slots, ui-primitives,
 *    ui-runtime/client) through its own frozen module table; everything else is
 *    inlined. CSS Modules and `?inline` stylesheets are compiled by
 *    lightningcss into plugin-owned `<style>` injectors, exactly as the host
 *    preset does, so the tab's styles ship inside the bundle.
 *
 * Types are emitted separately by `tsc` (see the `build`/`prepare` scripts).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Package name stamped into the loader handoff and the injected style tags. */
const PLUGIN_ID = 'dsh-plugin-execution-graph'

/**
 * Specifiers the DSH host shares into its frozen browser module table. The
 * client bundle must import (never inline) these, or a second React/cordis
 * instance would be bundled and break shared runtime identity. This list must
 * match the host's platform module set plus the preloaded runtime client entry.
 */
const HOST_PROVIDED_EXTERNALS = new Set<string>([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

/** Production deps kept as imports in the Node half (present on disk at install). */
const NODE_HALF_EXTERNAL = /^@xyflow\/react(\/|$)/

const CSS_VIRTUAL_PREFIX = '\0eg-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0eg-inline-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0eg-global-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/** Emit a plugin-owned style injector and an optional CSS Modules class map. */
function styleInjectionModule(
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const tagId = `${PLUGIN_ID}/${basename(fileId)}`
  const lines = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`,
  ]
  return lines.join('\n')
}

/** Resolve an imported stylesheet to an absolute path relative to its importer. */
function assetPath(source: string, importer: string | undefined): string {
  if (importer === undefined) return source
  const abs = resolvePath(dirname(importer), source)
  return existsSync(abs) ? abs : source
}

const cssModulesPlugin = {
  name: 'eg-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    return CSS_VIRTUAL_PREFIX + assetPath(source, importer) + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    // eslint-disable-next-line @typescript-eslint/no-invalid-this
    ;(this as { addWatchFile: (f: string) => void }).addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      classMap[local] = exp.name
    }
    return styleInjectionModule(fileId, code.toString(), classMap)
  },
}

const cssInlineTextPlugin = {
  name: 'eg-css-text-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
    const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
    return INLINE_CSS_VIRTUAL_PREFIX + assetPath(stylesheet, importer) + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    ;(this as { addWatchFile: (f: string) => void }).addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code } = transform({ filename: fileId, code: source, minify: true })
    return `export default ${JSON.stringify(code.toString())};`
  },
}

const cssGlobalPlugin = {
  name: 'eg-css-global-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
    if (source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
    return GLOBAL_CSS_VIRTUAL_PREFIX + assetPath(source, importer) + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    ;(this as { addWatchFile: (f: string) => void }).addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code } = transform({ filename: fileId, code: source, minify: true })
    return styleInjectionModule(fileId, code.toString())
  },
}

/** Node-half library build: the loader entry plus the invariant companion, plain ESM. */
const libConfig: UserConfig = {
  name: PLUGIN_ID,
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => NODE_HALF_EXTERNAL.test(specifier),
    alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !NODE_HALF_EXTERNAL.test(specifier),
  },
}

/** Browser client bundle: the closure-factory artifact the DSH host loads. */
const clientConfig: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => HOST_PROVIDED_EXTERNALS.has(specifier),
    alwaysBundle: (specifier: string) => !HOST_PROVIDED_EXTERNALS.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulesPlugin, cssInlineTextPlugin, cssGlobalPlugin],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [libConfig, clientConfig]
