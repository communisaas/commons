/**
 * Custom ESM loader that shims $env/* imports for running outside SvelteKit.
 *
 * Usage: node --import tsx --loader ./scripts/lib/env-loader.mjs scripts/seed-with-agents.ts
 *   or:  NODE_OPTIONS="--loader ./scripts/lib/env-loader.mjs" npx tsx scripts/seed-with-agents.ts
 */

import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

// Load .env and .env.local
function loadDotenv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.local']) {
    try {
      const content = readFileSync(pathResolve(process.cwd(), f), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in env)) env[key] = val;
      }
    } catch { /* file not found */ }
  }
  return env;
}

const envVars = loadDotenv();

export function resolve(specifier, context, nextResolve) {
  if (specifier === '$env/static/public' || specifier === '$env/dynamic/private') {
    return { url: 'env-shim://' + specifier, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.startsWith('env-shim://')) {
    const isPublic = url.includes('static/public');
    const entries = Object.entries(envVars)
      .filter(([k]) => isPublic ? k.startsWith('PUBLIC_') || k.startsWith('VITE_') : true);

    const exports = entries.map(([k, v]) =>
      `export const ${k} = ${JSON.stringify(v ?? '')};`
    ).join('\n');

    const source = isPublic
      ? exports
      : `${exports}\nexport const env = ${JSON.stringify(Object.fromEntries(entries))};`;

    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
