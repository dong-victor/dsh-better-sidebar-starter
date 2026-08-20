/**
 * tsdown build for @dong-victor/dsh-better-sidebar-starter: the host-half
 * lib (lib/index.js, ESM node — the /api/dsh-better-sidebar-starter routes
 * and the logs WebSocket) plus the browser client bundle (lib/client.js,
 * CJS closure factory registered with the module loader under the plugin id).
 *
 * The client bundle replicates the DSH client-bundle preset: react/cordis
 * resolve through the loader's module table at runtime, everything else is
 * inlined, and the artifact registers itself via
 * `window.__ModuleLoader__.load({ id, factory })`.
 */
import { defineConfig } from 'tsdown'

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
]

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    clean: true,
    external: ['ws'],
    outExtensions: () => ({ js: '.js' }),
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({\n\tid: "@dong-victor/dsh-better-sidebar-starter",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
      footer: 'return module.exports;\n\t}\n});',
      codeSplitting: false,
    },
  },
])
