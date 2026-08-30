/**
 * Regenerate `public/i18n/en.json` from the keys the app actually uses.
 *
 * ## Why English lives in a comment
 *
 * Key-based i18n has one real cost: `{{ 'footer.privacy' | transloco }}` tells a
 * developer reading the component nothing about what the button says. The usual
 * fixes are both worse — a second hand-maintained English file is just `en.json`
 * wearing a hat, and inline English defaults in the pipe call make every
 * template noisier and every diff bigger.
 *
 * So English is declared next to its key in a comment the extractor reads:
 *
 *     <!-- i18n footer.privacy: Privacy -->
 *     // i18n footer.privacy: Privacy      (in a .ts file)
 *
 * The comment is the **source of truth for English**, `en.json` is generated
 * from it, and nobody hand-edits `en.json`. A developer editing the footer sees
 * the English right there; a translator gets a clean dictionary.
 *
 * `--check` fails when `en.json` on disk differs from what would be generated,
 * which is what keeps "generated" true rather than aspirational. It runs inside
 * `check:i18n`.
 *
 * Run: `npm run i18n:extract` (or `make i18n-extract`)
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(ROOT, 'src', 'app');
const EN_PATH = join(ROOT, 'public', 'i18n', 'en.json');

const CHECK = process.argv.includes('--check');

/** Every non-spec source file under `src/app`. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.(html|ts)$/.test(entry) && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Declarations of the form `i18n <key>: <english>`, in either comment syntax.
 *
 * The English runs to the end of the comment, so it may contain colons,
 * apostrophes and `{{placeholders}}` without escaping.
 */
function declarations(text) {
  const found = [];
  const patterns = [
    /<!--\s*i18n\s+([\w.]+)\s*:\s*([\s\S]*?)\s*-->/g,
    /\/\/\s*i18n\s+([\w.]+)\s*:\s*(.*)$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.push([match[1], match[2].trim()]);
    }
  }
  return found;
}

/** `{'a.b': 'x'}` -> `{a: {b: 'x'}}`, so the file stays readable and diffable. */
function nest(flat) {
  const out = {};
  for (const key of Object.keys(flat).sort()) {
    // Only the final dot separates a leaf from its group: `footer.hotkeys.title`
    // nests under `footer` as the literal key `hotkeys.title`, so a key and a
    // group can share a name without one clobbering the other.
    const cut = key.indexOf('.');
    if (cut === -1) {
      out[key] = flat[key];
      continue;
    }
    const group = key.slice(0, cut);
    const rest = key.slice(cut + 1);
    out[group] ??= {};
    out[group][rest] = flat[key];
  }
  return out;
}

const english = {};
const duplicates = [];

for (const file of sources(APP_DIR)) {
  const rel = relative(APP_DIR, file).replace(/\\/g, '/');
  for (const [key, value] of declarations(readFileSync(file, 'utf8'))) {
    if (key in english && english[key] !== value) {
      duplicates.push(`${key} — "${english[key]}" vs "${value}" (${rel})`);
    }
    english[key] = value;
  }
}

if (duplicates.length > 0) {
  console.error('\nA key is declared twice with different English:\n');
  for (const duplicate of duplicates) {
    console.error(`  - ${duplicate}`);
  }
  console.error('\nOne key, one English string. Rename one of them.\n');
  process.exit(1);
}

const generated = `${JSON.stringify(nest(english), null, 2)}\n`;

if (CHECK) {
  let current = '';
  try {
    current = readFileSync(EN_PATH, 'utf8');
  } catch {
    current = '';
  }
  if (current !== generated) {
    console.error(
      '\npublic/i18n/en.json is out of date.\n\n' +
        '  Run: npm run i18n:extract\n\n' +
        'en.json is generated from `i18n <key>: <English>` comments next to each\n' +
        'key. Edit the comment, not the JSON.\n',
    );
    process.exit(1);
  }
  console.log(`en.json is up to date — ${Object.keys(english).length} keys.`);
} else {
  writeFileSync(EN_PATH, generated);
  console.log(`Wrote en.json — ${Object.keys(english).length} keys.`);
}
