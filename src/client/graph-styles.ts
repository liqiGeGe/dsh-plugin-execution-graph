/** Plugin-owned injection of React Flow's vendored functional stylesheet. */

import type { Context } from '@deepseek-ai/cordis'
import reactFlowBase from './styles/reactflow-base.css?inline'

const PLUGIN_ID = 'dsh-plugin-execution-graph'

/**
 * Mount React Flow's base stylesheet for exactly the owning plugin lifetime.
 * React Flow ships its layout styles as a package stylesheet; the client
 * bundler resolves `.css` imports relative to the importer, so the sheet is
 * vendored under `styles/` and injected here as a plugin-owned `<style>` tag
 * (the `ui-theme` pattern), removed on fiber disposal.
 *
 * @param ctx - Owning plugin context.
 */
export function installGraphStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/reactflow-base.css`
    tag.textContent = reactFlowBase
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'ui-graph: react-flow base stylesheet')
}
