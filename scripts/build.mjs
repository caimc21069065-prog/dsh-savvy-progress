/**
 * Build script: host entry as external-preserving ESM, client entry as a
 * `window.__ModuleLoader__.load({id, factory})` registration bundle (CJS
 * body, only `react` externals), and `.d.ts` via tsc.
 */

import { rm, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await rm(join(root, 'lib'), { recursive: true, force: true })
await mkdir(join(root, 'lib'), { recursive: true })

// Host half: ESM, all package imports external (peers + deps resolved by the host loader).
await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  sourcemap: 'linked',
  logLevel: 'info',
})

// Type re-export stub used by exports["./types"].
await build({
  entryPoints: [join(root, 'src/types.ts')],
  outfile: join(root, 'lib/types.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  logLevel: 'info',
})

// Client half: CJS body wrapped in the client module loader's registration
// form; every @deepseek-ai import in the client sources is type-only and
// erased, so only react stays external.
const banner = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-savvy-progress",',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
].join('\n')

const footer = [
  '    return module.exports;',
  '  }',
  '});',
].join('\n')

await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  banner: { js: banner },
  footer: { js: footer },
  legalComments: 'none',
  jsx: 'automatic',
  logLevel: 'info',
})

// Declarations for both halves.
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', 'tsconfig.build.json'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
)
console.log('build complete')
