/**
 * Fail the build when a localStorage key is not classified in the storage
 * registry.
 *
 * Settings export is aimed at publishing a setup to a public gist, so "is this
 * key safe to write to a file?" has to be answered for every key that exists —
 * not just the ones someone remembered. `src/app/storage-registry.ts` refuses
 * to export anything it does not recognise, which makes forgetting a key safe
 * but silent: the key just never gets exported, including keys that *should*
 * be. This script is the other half, turning the omission into a build failure.
 *
 * It lives here rather than in a vitest spec because the Angular test build has
 * no Node types and no filesystem access.
 *
 * Run: `npm run check:storage`
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(ROOT, 'src', 'app');
const REGISTRY = join(APP_DIR, 'storage-registry.ts');

/**
 * Keys that no longer exist in the source but stay classified so that data
 * lingering in a real browser is still recognised (and still excluded).
 */
const LEGACY_KEYS = new Set(['mockingbird_raindrop_credentials']);

/** Every non-spec .ts file under src/app. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Storage keys declared in the source, as `base -> file`.
 *
 * Every key in this app is declared as a `const NAME = '<literal>'` so it can
 * be account-scoped before use, so matching the declaration is a reliable proxy
 * — and it avoids matching the same literals where they appear in comments or
 * in the registry's own notes.
 */
function declaredKeys() {
  const found = new Map();
  const declaration =
    /(?:const|readonly)\s+\w+\s*(?::\s*string\s*)?=\s*'((?:mastodon_mock|mockingbird)[._][a-z0-9._:-]+)'/g;
  for (const file of sourceFiles(APP_DIR)) {
    if (file === REGISTRY) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(declaration)) {
      // A trailing `_` or `.` marks a key *prefix* used to match a family of
      // keys (ANONYMOUS_PREFIX), not a key base. A trailing `:` is different:
      // that is how instance-suffixed keys are built, so the literal really is
      // the registered base.
      if (/[._]$/.test(match[1])) continue;
      found.set(match[1], relative(ROOT, file).replaceAll('\\', '/'));
    }
  }
  return found;
}

/** Key bases listed in the registry, with their sensitivity. */
function registeredKeys() {
  const text = readFileSync(REGISTRY, 'utf8');
  const entry =
    /base:\s*'([^']+)',\s*\n\s*storage:\s*'(?:local|session)',\s*\n\s*suffix:\s*'(?:none|account|instance)',\s*\n\s*sensitivity:\s*'([^']+)'/g;
  const found = new Map();
  for (const match of text.matchAll(entry)) {
    found.set(match[1], match[2]);
  }
  return found;
}

const declared = declaredKeys();
const registered = registeredKeys();
const problems = [];

if (registered.size === 0) {
  problems.push(
    'Could not parse any entries out of storage-registry.ts — has STORAGE_KEYS changed shape?',
  );
}

for (const [base, file] of declared) {
  if (!registered.has(base)) {
    problems.push(`Unclassified storage key '${base}' declared in ${file}`);
  }
}

for (const base of registered.keys()) {
  if (!declared.has(base) && !LEGACY_KEYS.has(base)) {
    problems.push(
      `Registry lists '${base}' but no source file declares it — remove it, or add it to LEGACY_KEYS.`,
    );
  }
}

if (problems.length > 0) {
  console.error('\nStorage registry is out of date:\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nEvery localStorage key must be classified in src/app/storage-registry.ts so that\n' +
      'settings export can never publish something it should not. See docs/security.md.\n',
  );
  process.exit(1);
}

console.log(`Storage registry OK — ${registered.size} keys classified.`);
