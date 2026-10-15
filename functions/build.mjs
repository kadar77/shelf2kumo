// Bundles all functions (including the apps/web storefront renderer and workspace packages) into
// functions/deploy/, a self-contained source directory with only real npm runtime dependencies.
import { build } from 'esbuild';
import { copyFile, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = `${here}deploy`;
const manifestPath = `${here}../apps/web/dist/.vite/manifest.json`;

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  throw new Error(`Missing ${manifestPath}. Build apps/web first (pnpm --filter @shelf2kumo/web build).`);
}
const storefrontCss = manifest['src/storefront/storefront.css'];
if (!storefrontCss?.file) throw new Error('Vite manifest has no storefront stylesheet entry.');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const pkg = JSON.parse(await readFile(`${here}package.json`, 'utf8'));
const runtimeDependencies = Object.keys(pkg.dependencies);

await build({
  entryPoints: [`${here}src/index.ts`],
  outfile: `${outDir}/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  jsx: 'automatic',
  sourcemap: true,
  legalComments: 'none',
  external: runtimeDependencies.flatMap((name) => [name, `${name}/*`]),
  define: {
    __STOREFRONT_CSS_HREF__: JSON.stringify(`/${storefrontCss.file}`),
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

await writeFile(
  `${outDir}/package.json`,
  `${JSON.stringify(
    {
      name: 'shelf2kumo-functions',
      private: true,
      type: 'module',
      main: 'index.js',
      engines: { node: '22' },
      dependencies: pkg.dependencies,
    },
    null,
    2,
  )}\n`,
);

// Functions read non-secret parameters from dotenv files in the source directory.
for (const name of await readdir(here)) {
  if (name.startsWith('.env')) await copyFile(`${here}${name}`, `${outDir}/${name}`);
}

// Emulator-only placeholder so local runs never fetch the real secret (deploys ignore *.local files).
// Extraction uses labeled fixtures in the emulator; a developer can supply functions/.secret.local instead.
if (!(await readdir(here)).includes('.secret.local')) {
  await writeFile(`${outDir}/.secret.local`, 'AMD_API_KEY=emulator-placeholder-not-a-key\n');
} else {
  await copyFile(`${here}.secret.local`, `${outDir}/.secret.local`);
}

// The Firebase CLI discovers functions via the SDK in <source>/node_modules. Link the workspace
// install for local discovery and emulators; deploys ignore node_modules and install from package.json.
await symlink('../node_modules', `${outDir}/node_modules`, 'dir');

console.log(`Bundled functions to ${outDir} (storefront CSS: /${storefrontCss.file})`);
