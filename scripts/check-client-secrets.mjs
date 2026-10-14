// Fails if built client assets contain AMD credentials, endpoint details or server-only code.
// Usage: node scripts/check-client-secrets.mjs [distDir]
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'apps/web/dist';

const patterns = [
  { label: 'AMD_API_KEY identifier', test: (text) => text.includes('AMD_API_KEY') },
  { label: 'AMD endpoint host', test: (text) => text.includes('developer.amd.com') },
  { label: 'server-only adapter marker', test: (text) => text.includes('@shelf2kumo/ai is server-only') },
  { label: 'Authorization bearer header', test: (text) => /Bearer\s+[A-Za-z0-9._-]{12,}/.test(text) },
];

const key = process.env.AMD_API_KEY;
if (key && key.length >= 8) patterns.push({ label: 'AMD_API_KEY value', test: (text) => text.includes(key) });

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

let scanned = 0;
const findings = [];
try {
  for await (const path of files(distDir)) {
    if (!/\.(js|mjs|css|html|json|map|txt)$/.test(path)) continue;
    scanned += 1;
    const text = await readFile(path, 'utf8');
    for (const pattern of patterns) if (pattern.test(text)) findings.push(`${path}: ${pattern.label}`);
  }
} catch (error) {
  console.error(`Cannot scan ${distDir}: ${error.message}. Build the web app first.`);
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`Secret check FAILED:\n${findings.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`Secret check passed: ${scanned} client files scanned in ${distDir}${key ? ' (including AMD_API_KEY value)' : ''}.`);
