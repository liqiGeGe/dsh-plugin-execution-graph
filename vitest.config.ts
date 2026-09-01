/**
 * Standalone vitest config for the execution-graph plugin.
 *
 * Client component specs opt into jsdom via a per-file `// @vitest-environment
 * jsdom` pragma. CSS Module imports (`*.module.css`) and inline stylesheet
 * imports (`*.css?inline`) are stubbed so the component tree renders without a
 * real CSS pipeline — class names collapse to their local key and inline CSS is
 * an empty string, which is all the DOM assertions here need.
 *
 * The `@deepseek-ai/*` framework packages resolve to the sibling monorepo's
 * TypeScript SOURCE (not their built `lib/`, whose `/client` entries are
 * browser closure-factories), and the React family is pinned to one physical
 * instance so react-dom and the components share the same `ReactSharedInternals`
 * (two React copies break hook identity).
 */
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** The sibling monorepo checkout supplying the framework source graph. */
const MONOREPO = fileURLToPath(new URL('../deepseek-harness/', import.meta.url))

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Transform standard TypeScript decorators before Vite's default parser sees
 * them. The framework source resolved from the sibling checkout uses cordis's
 * decorator-based `Service` classes; esbuild (Vite's default) does not lower
 * standard decorators, so pre-transform those files with tsc.
 */
function standardDecoratorPlugin(): Plugin {
  return {
    name: 'eg-standard-decorators',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0] as string
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

/** Stub CSS imports so specs need no CSS bundler. */
function cssStubPlugin(): Plugin {
  const CSS_MODULE = /\.module\.css$/
  const CSS_INLINE = /\.css\?inline$/
  const CSS_PLAIN = /\.css$/
  return {
    name: 'eg-css-stub',
    enforce: 'pre',
    resolveId(source) {
      if (CSS_MODULE.test(source) || CSS_INLINE.test(source) || CSS_PLAIN.test(source)) {
        return `\0eg-css-stub:${source}`
      }
      return null
    },
    load(id) {
      if (!id.startsWith('\0eg-css-stub:')) return null
      const source = id.slice('\0eg-css-stub:'.length)
      if (CSS_MODULE.test(source)) {
        // A Proxy returns the requested class name as its own value, so
        // `css.foo` === 'foo' — stable, unique-enough keys for DOM queries.
        return 'export default new Proxy({}, { get: (_t, key) => String(key) });'
      }
      // `?inline` text and plain global CSS are irrelevant to behavior here.
      return 'export default "";'
    },
  }
}

/**
 * Resolve `@deepseek-ai/*` specifiers to the sibling monorepo's TypeScript
 * source (mirroring the monorepo's own `tsconfig.base.json` paths), and redirect
 * the React family to THIS project's node_modules copies so all code — this
 * package's and the framework's — imports one physical React instance.
 */
function frameworkSourceResolver(): Plugin {
  const toSrc = (spec: string): string | null => {
    if (!spec.startsWith('@deepseek-ai/')) return null
    if (spec === '@deepseek-ai/cordis') {
      return fileURLToPath(new URL('vendor/cordis/src/index.ts', `file://${MONOREPO}`))
    }
    const rest = spec.slice('@deepseek-ai/'.length)
    const m = rest.match(/^dsh-client-([a-z0-9-]+)(\/client|\/invariant)?$/)
    if (m === null) return null
    const group = rest.startsWith('dsh-client-ui-') ? 'ui-' + m[1] : m[1]
    const sub = m[2] ?? ''
    const entry = sub === '' ? 'index.ts' : `${sub.slice(1)}/index.ts`
    const dir = rest.startsWith('dsh-client-ui-') ? `packages/client/ui-${m[1]}` : `packages/client/${group}`
    const candidate = `${dir}/src/${entry}`
    const abs = fileURLToPath(new URL(candidate, `file://${MONOREPO}`))
    return existsSync(abs) ? abs : null
  }
  const toThisReact = (spec: string): string | null => {
    const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
    switch (spec) {
      case 'react': return here('node_modules/react/index.js')
      case 'react/jsx-runtime': return here('node_modules/react/jsx-runtime.js')
      case 'react/jsx-dev-runtime': return here('node_modules/react/jsx-dev-runtime.js')
      case 'react-dom': return here('node_modules/react-dom/index.js')
      case 'react-dom/client': return here('node_modules/react-dom/client.js')
      default: return null
    }
  }
  return {
    name: 'eg-framework-source',
    enforce: 'pre',
    resolveId(source) {
      return toThisReact(source) ?? toSrc(source)
    },
  }
}

/**
 * Vite-level aliases forcing every bare react import — including those inside
 * framework source files that physically live in the sibling monorepo — onto
 * THIS project's single react copy. `resolve.alias` applies to all importers
 * unconditionally (unlike my `resolveId` plugin, which vitest may bypass when
 * Node-resolving a framework file's own dependencies).
 */
function reactAliases(): { find: string | RegExp; replacement: string }[] {
  const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
  return [
    { find: /^react$/, replacement: here('node_modules/react/index.js') },
    { find: /^react\/jsx-runtime$/, replacement: here('node_modules/react/jsx-runtime.js') },
    { find: /^react\/jsx-dev-runtime$/, replacement: here('node_modules/react/jsx-dev-runtime.js') },
    { find: /^react-dom$/, replacement: here('node_modules/react-dom/index.js') },
    { find: /^react-dom\/client$/, replacement: here('node_modules/react-dom/client.js') },
    // `use-sync-external-store` (used by the framework's useSelector) imports
    // react and must pair with the same single instance; the framework's own
    // copy lives in the monorepo and would drag in a second react. Point only
    // the bare specifier at MY package directory root; subpaths (`/shim`,
    // `/shim/with-selector`) then resolve into that same directory, keeping
    // every entry paired with MY react.
    { find: /^use-sync-external-store$/, replacement: here('node_modules/use-sync-external-store/index.js') },
    { find: /^use-sync-external-store\/shim$/, replacement: here('node_modules/use-sync-external-store/shim/index.js') },
    { find: /^use-sync-external-store\/shim\/with-selector$/, replacement: here('node_modules/use-sync-external-store/shim/with-selector.js') },
  ]
}

export default defineConfig({
  plugins: [
    cssStubPlugin(),
    // Only wire source-resolution when the sibling checkout is present (dev).
    ...(existsSync(MONOREPO) ? [frameworkSourceResolver(), standardDecoratorPlugin()] : []),
  ],
  resolve: {
    alias: reactAliases(),
  },
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    css: false,
  },
})
