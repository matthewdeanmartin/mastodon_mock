# ui-i18n-8 — parallel migration

**Started 2026-08-30.** The remaining migration is 3,576 strings across 121
directories. One agent doing them serially is the wrong shape; the work is
naturally per-directory and the gate is objective, so it fans out.

## Why this is safe to parallelise

Three properties, in order of importance:

1. **`npm run check:i18n` is pass/fail.** An agent cannot "mostly" finish a
   directory. The gate is the acceptance test, not a reviewer's judgement.
2. **The mechanical half is scripted.** `scripts/i18n-scan.mjs` finds every
   string (including the `{{ }}` literals the gate itself cannot see);
   `scripts/i18n-apply.mjs` rewrites by byte offset, so it cannot drift the way
   a hand-copied snippet does when Prettier rewraps the prose above it.
3. **Directories are independent** — separate templates, separate key
   namespaces, and `MIGRATED` is already a per-directory ratchet.

What is left for the agent is the judgement: naming keys, and spotting the three
shapes that render correctly in English and wrongly in German.

## What a cheap model will get wrong

Both failures found while migrating `import-export` and `mawkingbird-plus` by
hand, and both invisible until a German speaker is stuck:

- **Concatenated sentences** — `'Exporting ' + count() + '…'`. English word
  order is not universal.
- **Pluralisation by glued suffix** — `post{{ n === 1 ? '' : 's' }}`. Wrong in
  German, Finnish, Russian, Polish, Arabic.

`.claude/skills/migrate-i18n/SKILL.md` makes both non-negotiable and shows the
replacement shape. Every agent is told to load it first and to do those
restructures *before* any bulk replacement.

A third failure is structural rather than linguistic: **English literals inside
`{{ }}`** (`busy() ? 'Saving…' : 'Save'`). `check-i18n.mjs` matches per line and
cannot see them, so they survive a directory being marked migrated. Only
`i18n-scan.mjs` finds them, which is why the skill makes the scan the first step
and the last.

## Coordination

Every agent would otherwise edit one shared file — the `MIGRATED` array in
`scripts/check-i18n.mjs`. That is the only contention point, so it is handled
centrally: directories are appended to `MIGRATED` **before** the wave launches,
and agents are told not to touch it. An agent whose directory is already listed
simply has to make it pass.

Waves are sized so no two agents share a directory subtree.

## Tools added this sprint

| | |
|---|---|
| `scripts/i18n-scan.mjs` | text nodes + static attributes + `{{ }}` literals, with line numbers |
| `scripts/i18n-apply.mjs` | applies a `{text, key}` map by byte offset; `--report` dry-runs it |
| `scripts/i18n-survey.mjs` | remaining strings per directory, skipping what is already migrated |
| `.claude/skills/migrate-i18n/SKILL.md` | the procedure an agent follows |

## Review

Opus re-checks each finished directory before it is trusted:

- `node scripts/i18n-scan.mjs` on every template — the residue must be
  justifiable (pipe formats like `'medium'`, `ALLOWED` entries), not merely small.
- `grep` for `=== 1 ?` and `' +` across the changed files — the two silent bugs.
- Keys read as sentences, not as fragments a translator has to reassemble.
