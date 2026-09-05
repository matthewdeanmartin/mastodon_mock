---
name: translate-ui
description: Translate Mockingbird's interface into another language, or add a new UI language end to end. Use when filling in UI locale dictionaries, working an i18n-context translation work order, adding a locale to IN_PROGRESS_LOCALES, or reviewing a locale someone else translated.
---

# Translating Mockingbird's interface

## Required translation method — no external machine translation

**Luna directly authors every translation from English, context, glossary and
actual UI usage. Do not use Google Translate, DeepL, other translation APIs,
or external machine-translation scripts.** Tools may extract work, validate
structure, and merge authored translations; they must not replace Luna's
translation work. Do not use bulk dictionary substitutions, positional newline
mapping of translated text, or copies of English prose to pretend placeholders
are complete. If a source structure blocks translation, report it to Astra.

This is explicit user direction following the rejected 2026-09-05 Taiwan draft.

**No filler generation:** an agent subsequently replaced unhandled English words
with repeated `相關內容` and passed structural dry-runs. This is not translation.
Do not generate batches with token maps, catch-all replacements or generic filler.
Passing JSON/placeholder/markup checks never authorizes such output. Do not claim
a completed translation batch while knowing it needs wholesale linguistic work.
The coordinator must reject obvious filler before merge; Astra may directly repair
it in the single bounded review-and-fix pass, never an infinite resubmission loop.

## Current execution policy (2026-09-05)

**Current status: STOPPED.** Ukrainian and Taiwan Traditional Chinese each have
5,866 accepted/reviewed keys; both final audits passed and all workers stopped.
The user requested a speedup plan, saved at `sprint/ui-i18n-speedup-plan.md`.
No pilot, new language or plan implementation is authorized by that document.
Resume only on new user direction. The historical execution updates below are
lessons, not instructions to restart completed work.

**Latest model change:** The user authorized trying Sol or Terra after Luna's
repeated partial returns and prohibited phrase mapping. Use Sol (`gpt-5.6-sol`)
to finish remaining Taiwan authoring, and a separate Sol agent for one independent
final-product review. This supersedes Luna-only authorship for this finish. Astra
still owns concrete complex templates. Do not make the author review itself.
Retain the stop-after-Ukrainian-and-Taiwan boundary and measure wall time.
Set `reasoning_effort: "low"` explicitly for routine author/reviewer spawns.
Checked rollout turn_context records showed Luna at medium, Sol at low and the
Astra coordinator at low when the spawn omitted effort. Do not assume omission
means the desired level; record the effective rollout value.
Per-agent token counters ARE available in local Codex rollout `token_count`
events, although collaboration tools omit them. Read only the relevant task's
metadata/counters; record input, cached input, output and reasoning output.
Cached input is a subset of input, and reasoning output is a subset of output:
do not double-count them or equate raw token totals with billed cost. Capture
coordinator snapshots/deltas separately from child totals; root cumulative usage
covers earlier work too and is not this resume's token usage.

Preserve genuinely authored partial work across forced continuations. Never
restore rejected generated text over new authored values merely because the
whole batch is incomplete. After the rejected Taiwan B draft and an unsuccessful
Sol attempt, Terra completed a separate `terra-b.json` across two turns; a new
output path prevented confusing rejected and accepted candidates. A partial
return is resumable progress, not assignment completion. Validate exact key-set
equality separately from merge dry-run counts before independent review.

**Stop boundary and timing (latest user instruction):** Ukrainian is finished
at 5,866 accepted/reviewed keys. Finish only the paused Taiwan Traditional Chinese
locale next, then STOP all translation work. Do not start another language.
The user wants to brainstorm a roughly 5× speedup before further expansion.
Taiwan resume began at 2026-09-05 22:45:53 UTC. Record wall-clock dispatch and
completion times for translation/review, coordinator integration and checks in
`ui/i18n-context/timing-2026-09-05.json`. Separate elapsed critical-path time from
summed concurrent worker durations. Report token usage only if actually exposed;
otherwise mark it unavailable, never infer tokens from elapsed time. Track partial
returns/resumes as overhead. Reuse saved work and avoid idle dispatch gaps.
The resume inventory is `ui/i18n-context/zh-Hant-resume-plan.json`: one 699-key
review of existing drafts plus targeted English-vocabulary repairs, and two
disjoint direct-authoring batches of 500 and 565. This completes existing Taiwan
work without repartitioning completed keys. Luna authors; Sol reviews final
products once; Astra handles concrete complex template issues. Older Taiwan
instructions requiring Astra for every routine review are superseded.

Timing/reliability lesson from the Taiwan resume: the 565-key Luna worker again
produced prohibited phrase-mapped text with untranslated English fragments. It
was rejected without merge. Its reported 9.586-second interval covered only the
end of the work, not the full authoring assignment. Record coordinator dispatch
and receipt times as the authoritative task interval; worker clocks are useful
substage measurements only when they cover the actual stage. Mark rejected work
and partial returns explicitly, not as completed throughput. Root requested the
user's preference before changing the original Luna-authoring requirement.

**Latest review trial:** Luna still authors. Use Sol (`gpt-5.6-sol`) for the next
routine Ukrainian reviews; Astra keeps complex template/source repairs and finishes
any review already underway. This overrides the older Astra-for-every-batch rule
below. Review the final authored file against English/context/glossary in a fresh
context, not the translator's dialog. Read UI call sites only where meaning,
fragments or parameters require them. Do not rewrite acceptable wording merely
for stylistic preference. Keep the single independent review-and-fix pass cap;
do not add an Astra review of Sol's whole review. Escalate only concrete complex
template defects, with exact keys and call sites.

Each reviewer reports assigned/reviewed key count, unique strings changed, and
counts of meaning errors, placeholder/count/grammar defects, terminology fixes,
and optional polish. State whether categories overlap or counts are estimates.
Distinguish validation blockers/source repairs from wording changes. Compare the
final file against the input mechanically; do not perform another semantic pass
just to produce metrics. A correction percentage alone does not measure severity.

Ukrainian is now the active language at the user's request; Taiwanese work is
paused at its saved ledger. User increased parallelism: fill available worker
slots (currently three subagents plus coordinator). Prefer fresh contexts for
each one or two fixed batches; retire completed workers before replacing them.
This supersedes the earlier two-worker limit below. All workers write disjoint
artifacts; only the coordinator merges dictionaries and ledgers.
Keep orchestration running when the user asks a status/workflow question: answer
briefly and continue dispatch/review. Do not end the active translation turn just
to answer a question while authorized work remains. Record a durable checkpoint
before any user-requested language switch.

Dispatching workers is not completion. Keep collecting outputs and replacing
finished workers until the active language is accepted or a concrete blocker
requires user input. A worker that returns a partial file must be resumed for
the remaining assigned keys. A successful merge dry-run validates only supplied
keys: compare the output key set with the fixed work order before declaring a
batch complete. Batch 008 passed a 260-key dry-run despite its 500-key assignment.
Batch 010 also stopped at 322 keys without a blocker. Resume such workers rather
than treating a partial final message as task completion. Authoring 500 entries
does not require one enormous response: read/write manageable internal chunks
and continue tool calls until the fixed assignment is complete. “These keys need
direct translation” is the task, not a blocker. Until completion is reliable,
prefer one 500-key assignment per translator dispatch over paired assignments.
Concurrency overlaps batches; it does not reduce their number. At 5,857 keys,
500-key assignments mean 12 translation batches plus their independent reviews.
Review metrics are saved in `ui/i18n-context/review-uk-2026-09-05.md`.

Ukrainian uses `ui/i18n-context/glossary-uk.md` and accepted/reviewed source
tracking in `ledger-uk.json`. Existing complete binary count messages may use
grammatical labelled totals in both branches (`Дописи: {{count}}`), since English
`count === 1` does not cover Ukrainian one/few/many/other. No ICU compiler exists.
Report noun fragments with their call sites for a bounded Astra source fix;
never silently regenerate frozen English snapshots to bypass a mismatch.
When a bounded source fix adds complete count messages, preserve all assigned
batch IDs/memberships and append new keys only to the undispatched final remainder.
Verify every old source hash before this explicit reconciliation. Author-count
repair added two messages; the later Twitter account-summary repair added one
more. The final adoption-dialog repair added eight whole messages after the
original batches were reviewed: current final inventory is 366 keys (5,866 total).
That bounded repair used its own eight-key work order and original source snapshot,
one Luna authoring pass and one Sol review. Existing assignments, source hashes
and reviewed snapshots were preserved; the eight new keys were explicitly
appended to the final common inventory. Never refresh old snapshots to hide drift.

Verified English-only vocabulary arguments may be omitted in a translated whole
message when listed by exact key+parameter in
`ui/scripts/i18n-optional-terminology.mjs`. Astra verifies the call site before
extending this map. This lets each language inflect its canonical noun directly;
never omit actual counts, names or data merely because a parameter is named
post/posts/noun. Merge and check-i18n share this policy. English custom vocabulary
bindings remain unchanged; the map is a separately versioned validation dependency.

**Scratch hygiene:** All temporary work orders, per-batch snapshots, drafts,
review subsets and one-off helper scripts go in ignored
`ui/.i18n-work/<locale>/`, never `ui/src/` or the `ui/` root. Do not stage or commit
scratch files. Keep them until coordinator acceptance/cleanup so work can resume.
Only dictionaries, glossaries, the durable review ledger, shared fixed inventory
and reusable tooling belong in the change. Prefix `F=` and `--source=` paths with
`.i18n-work/<locale>/` in the older examples below. Never run `git add` as part of
translation; the coordinator manages reviewable changes.
Do not use `git add -f` or otherwise force ignored scratch into Git. An ignored
file is supposed to remain untracked. In worker prompts, say "write output files"
rather than "stage output": one worker misread staging language and force-added
a draft despite the explicit rule. Coordinator checks the index after handoffs
and unstages only accidental scratch entries, preserving files and real changes.

**Validation budget (latest user direction):** Do not launch a browser or run
visual/overflow checks for this expansion; the user will handle those later.
Run fast dictionary/source/placeholder/markup checks per batch. Do not run the
full UI suite per batch or per language. It has already passed once for the Taiwan
shared-code changes (6,209 tests); rerun only when subsequent code changes warrant
it or the repository's final handoff gate requires it. Pure translation work
does not justify repeated unrelated UI test runs. Upcoming languages all use
the same fixed 500-key source batches, not per-agent ad hoc work selection.

Fixed upcoming work inventory: `ui/i18n-context/fixed-batches.json` contains
12 identical assignments for every new language (11 × 500 keys, final 355 at
creation). From `ui/`, `node scripts/i18n-fixed-batches.mjs` checks the frozen
inventory without writing. Emit an assigned work order and locale source snapshot
with `node scripts/i18n-fixed-batches.mjs --batch=001 --locale=uk
--source=tmp_uk_001.source.json`. The coordinator assigns the ID; agents do not
survey, repartition or choose areas. Changed source/context fails explicitly;
reconcile affected assignments instead of silently refreshing translation stamps.

**Convergence rule (latest user direction):** Astra is trusted to fix wording,
terminology and source templates directly, without escalation or sending minor
corrections back to Luna. Each Luna batch gets ONE independent Astra review-and-fix
pass. Allow at most ONE additional targeted correction pass for a concrete
unresolved defect (maximum two edit passes total). Astra does not review its own
fixes in another semantic review round. Run mechanical checks after edits, then
accept the completed batch. If a blocker survives the cap, record it explicitly
and keep the affected keys in progress; do not restart the loop or claim completion.
This replaces older correction-round instructions in this skill and the plan.
Luna remains the direct author of new translation batches; external MT is forbidden.
Ukrainian (`uk`) is NEXT after Taiwanese Chinese, using the 500+ batch policy.

Review lesson: read assembled templates for fragment keys, including inserted
links/emphasis; individually plausible fragments can duplicate words or reverse
the relationship. Distinguish blog articles from social posts, followed accounts
from followers, and relational labels (branch "on") from action labels. A glossary
replacement cannot decide those senses. Read source call sites for such keys.

Additional contextual checks from Taiwanese review: "Search saved" is a
confirmation, facets are broader than hashtags, model context means context-window
capacity, oldest refresh targets the stalest account cache, and home server means
the account's server. Inspect what numeric placeholders actually measure (e.g.
warning threshold versus current usage) before phrasing a warning.

Taiwan batch 11–12 review: Friends means followed accounts; weekday histograms
include weekends; scanned counts are accounts; Paste submission publishes an
item; reported statuses are social posts. Admin silence is moderation limitation,
distinct from personal mute. Preserve the exclusion in counterexamples, not just
their vocabulary. Counts need complete parameterized messages so Chinese measure
words can follow the number; source fixes are Astra's responsibility.

Taiwan 17–18: Credits on attribution pages means 致謝, a live Post button means
enabled publishing, Local timeline means 本站 (not device-local storage), and a
full bundle means 已滿. Inspect feature tables when prose contradicts behavior;
record source ambiguity instead of confidently translating the contradiction.

Use the available worker pool (currently **three concurrent workers**) and a
fresh subagent context after **one or two complete batches**.
Prefer Luna translation alongside Astra review of a different finished batch.
Assign disjoint batch files; serialize writes to the shared dictionary, ledger,
glossary and skills through the coordinator. A concurrent reviewer writes exact
approved values/source snapshots and corrections for later serialized merge.
Do not run two independent missing-key selectors that can claim the same keys;
reserve explicit nonoverlapping work before dispatching concurrent translators.
Workers retain their work orders, snapshots and output until the coordinator
cleans them up after acceptance. Never delete shared fixed-batch inventories.

User update: starting with the NEXT language after Taiwanese Chinese, use
**500+ keys per translation and review batch**. This ongoing `zh-Hant` run
retains its 300+ minimum. Final remainders and correction-only passes may be
smaller. Read/write slices within a batch are permitted and do not reduce the
batch size; accumulate the full batch before merge and review handoff.

For the current UI-only expansion, follow
`sprint/ui-i18n-9-thirty-languages.md`. Translate only languages with no progress
at the start. Defer existing in-progress German, French, Indonesian and Japanese;
do not review, repair or promote them in this run. English is the source.

Luna (`gpt-5.6-luna`) translates; Astra (`gpt-6-astra`) independently reviews every
batch and owns all complex templating and shared infrastructure. Use the worker
pipeline and serialized shared writes described above.

Use the current minimum (300 for this Taiwan run, 500 for subsequent languages).
Give each fresh agent one or two batches. Combine small areas and pull flat slices
for the tail. Only a final remainder or correction-only pass may be smaller.

Update the applicable SKILL.md whenever a reusable lesson is learned, before
the next batch or handoff; put specific vocabulary corrections in the locale
glossary and reference it here. Do not wait until the end of a language.

Verified repository lessons:
- File-edit chunks of 50 entries are permitted within a 300+ key translation batch;
  manage context by reading and authoring slices while completing the full merge.
- Review sentences as they render across every fragment and emphasized/link
  insertion. In Taiwan redo 01, `intro.a + before + intro.b` duplicated 之前
  and put it before the action. Moving wording between linked fragments is
  acceptable only after inspecting every call site; future source restructuring
  remains Astra's responsibility. Do not summarize away examples or explanatory
  consequences to make a long key easier to translate.
- "Last year", "Top", "Open", "Control", and "Mutuals" require call-site
  checks: they can mean a rolling 365-day filter, popularity ranking, approval-free
  following, a comparison probe, and reciprocal following. The glossary records
  the confirmed Taiwan meanings. Correct prose may still hide a wrong UI sense.
- Luna must write contextual translations itself. Do not call external machine
  translation services, concatenate batches for newline-position mapping, or
  use dictionary/global substitutions as a replacement for translation. The
  2026-09-05 Taiwan review found `translate_tmp.cjs` calling Google Translate
  in ten-line chunks; six nominal 300-key batches had pervasive wrong senses,
  translated brands/code, and English placeholder sentences left as "done".
  Placeholder or markup failures must be fixed by translating the sentence
  properly, never by copying its English wholesale to satisfy the merge gate.
  A merge acceptance stamp records source provenance, not linguistic approval.
  A source-only workfile can contain English; the submitted locale batch cannot
  claim untranslated prose as translated. Preserve only justified literal syntax
  and names. Record any unavoidable omission explicitly for Astra.
- Count unique keys actually merged, not workfiles produced. Re-merging an
  unchanged 300-key batch is zero translation progress. The locale ledger and
  `i18n-batch` totals are authoritative, and duplicate source/key inventories
  must not be dispatched or counted as new batches.
- Windows PowerShell's default Make shell cannot run the `test -n` guards.
  Add `'SHELL=C:/Program Files/Git/bin/bash.exe'` to the Make commands below
  on this machine (verified). The bare `bash` on PATH is the WSL launcher,
  so use the explicit Git Bash path.
- Taiwan Traditional Chinese uses `ui/i18n-context/glossary-zh-Hant.md`.
  Its source/review ledger is `ui/i18n-context/ledger-zh-Hant.json`, created on
  first accepted merge. Legacy `stamps.json` is neither read nor changed for it.
  From `ui/`, translate 300+ keys using
  `make i18n-batch L=zh-Hant N=300 ARGS=--snapshot=tmp_source.json`, then
  `make i18n-merge L=zh-Hant F=tmp_batch.json ARGS=--source=tmp_source.json`.
  Keep both scratch files until Astra independently reviews that entire batch;
  Astra records acceptance with
  `make i18n-merge L=zh-Hant F=tmp_batch.json ARGS="--source=tmp_source.json --reviewed"`.
  This refuses changed English/context or changed translation values. Do not
  regenerate a snapshot to bypass a source-change rejection; reread the changed
  source/context and retranslate first. Delete scratch files after acceptance.
  Ordinary `i18n-batch` now selects missing AND stale keys for this locale;
  `ARGS=--review` selects accepted but unreviewed keys and prints current text.
  Both translation work and review work must reach zero. Other locales retain
  legacy behavior; do not claim they gained reliable freshness tracking.
  An Astra-rejected batch carries `reviewRejected` in this ledger and is offered
  as stale work. A fresh contextual submission clears rejection; re-merging
  unchanged bad text is not a correction. The review report names the exact
  source inventories to redo, so do not discard their snapshots.
- A completed Chinese `.one`/`.other` message pair can use identical Chinese
  text for both values: current call sites still select the English branches.
  This is not ICU support. Do not emit ICU; flag broken fragments for Astra.
- `make i18n-batch L=xx N=300 ARGS=--areas` passes `--areas` to the script;
  bare `make ... --areas` is not a Make option. For translation omit `ARGS`.
- For legacy locales, `i18n-batch` selects missing keys only. `i18n-todo` writes source stamps when
  work is offered, not accepted; merge does not stamp acceptance. A zero work
  count is not proof of freshness. Astra must fix accounting before relying on
  it for the new locales; never run todo as a read-only freshness audit.
- Negotiation now preserves explicit Chinese scripts. Hant wins over region;
  TW/HK/MO infer Hant only when script is absent. Hans/CN/SG and bare zh never
  silently become Traditional Chinese. Availability still gates review locales.
- Existing wiring does not establish ICU support. Astra must implement and
  test the message/plural mechanism before translators emit ICU syntax.
- The merge tool serializes/sorts the target dictionary. Use it as required,
  but do not promise byte-preserving merges or manually reformat dictionaries.

You are translating the **interface** of a Mastodon/fediverse client — buttons, labels,
settings, error messages. Not post content, not documentation.

Roughly 5,700 keys per language, and the plan is 50–60 languages. So this skill is written
for **throughput at constant quality**, not for one careful language. Follow the procedure
in order; it is short, and every step in it exists because skipping it cost a re-read of
5,700 keys at least once.

**If you are coordinating this work across multiple dispatches (subagents, forks, or fresh
sessions): dispatch count is the dominant cost, not translation volume.** One 5,700-key
language done as ~5 large dispatches costs a small fraction of the same language done as
~50 small ones, because every dispatch re-pays the fixed cost of reading this skill and the
glossary before it translates anything. See "Batch size" in step 3 below before deciding how
to split the work.

---

## The procedure

Run everything from `mastodon_mock/ui`. The Make variable is `L`, not `LANG` — every POSIX
shell already exports `LANG`, and `make i18n-todo` with no argument once silently produced a
work order for a locale called `en_US.UTF-8`.

Invoke the batch/merge scripts through their `make` targets (`make i18n-batch L=id N=500
P=area`, `make i18n-merge L=id F=file.json`), not by calling `node scripts/i18n-batch.mjs`
directly with positional `N=`/`P=` arguments — the script does not parse those as flags on
its own, only `make` wires them in as the variables the script expects.

### 1. Register the locale (2 minutes)

```ts
// src/app/i18n/locale.ts
export const IN_PROGRESS_LOCALES = ['de', 'fr', 'id'] as const;   // add yours
export const LOCALE_ENDONYMS = { …, id: 'Bahasa Indonesia (sedang dikerjakan)' };
```

The endonym is the language's name **in its own language**, with an in-progress marker in
that language too. Someone who has landed in a language they cannot read needs to find their
own language in this list; "Indonesian" is no help to a reader who only reads Indonesian.

`IN_PROGRESS_LOCALES` ship on `/test/` and `/canary/` only. Do this **first**, not last:
you need the picker to look at your own work while translating. Move the locale to
`PRODUCTION_LOCALES` only when the checklist at the bottom is done.

### 2. Write the glossary **before translating anything**

Copy `i18n-context/glossary-id.md` to `glossary-<lang>.md` and fill it in. It takes twenty
minutes and it is the highest-leverage step in the whole process.

It must settle, in writing:

- **The formality register**, chosen once and held. This is not a style preference — German
  shipped 466 keys of `du` against 321 of `Sie`, and all 321 had to be rewritten by hand.
- **Every term in the glossary table below**, resolved to one word for this language.
- **The wrong senses to avoid** — write down, for each term, the meaning you do *not* mean.
  That list becomes the locale's trap words in step 5.

Then encode the mechanical parts in `scripts/i18n-locale-rules.mjs`: `rules` (hard gates that
reject a batch) and `traps` (advisory greps). See that file's header for which is which — a
gate with false positives gets worked around, which is worse than no gate.

### 3. Translate in batches, through the gate

```bash
make i18n-batch L=id ARGS=--areas     # what's left, biggest area first
make i18n-batch L=id N=500 P=settings.connections
```

`i18n-batch` prints only the keys still missing, as `key<TAB>English<TAB>context hints`.
Translate a slice into a flat JSON file (`{"dotted.key": "text"}`) and merge it:

```bash
make i18n-merge L=id F=tmp_batch.json
```

**Nothing reaches a locale file except through `i18n-merge`.** It rejects the batch *whole*
on a key that isn't in `en.json`, placeholder drift, markup drift, a `max` overflow, or any
rule the locale declares. On rejection, the merge output names the offending key(s) — fix
just those and resubmit the same file; do not throw away a large batch over one bad key.

Re-run `i18n-batch` after each merge and the next slice appears. **The locale file is the
progress ledger** — there is no bookkeeping to keep in your head or in a scratch note.

> **Write batch files with the Write tool, not a bash heredoc.** Curly apostrophes (’),
> nested quotes and em dashes break heredocs, and the shell error arrives after you have
> already spent the tokens composing the batch.

> **Write scratch batch files inside `mastodon_mock/ui/`** (e.g. `tmp_batch.json`), not
> `/tmp/` — in some sandboxes `/tmp/*.json` written by the Write tool doesn't resolve to a
> path the merge script can see, and the ENOENT only surfaces after the merge attempt.
> Delete the scratch file once it merges cleanly.

#### Batch size: go big, not 110-at-a-time

A 5,700-key language costs the same *whether you run it as fifty small dispatches or five
large ones* — but the dispatches themselves are not free. Each fresh session or subagent
pays fixed overhead (reading this skill, reading the glossary, orienting) before translating
a single key. Doing that fifty times instead of five is the single biggest cost driver in
this workflow — larger than anything about the translation itself.

So default to the largest batch that still fits one attention span and one merge:

- **`N=500` or larger** after this Taiwan run (`N=300` minimum for Taiwan). The gate doesn't care about batch
  size; only your own ability to hold the slice in mind while translating it does.
- **When several named areas are each small (under ~20 keys), translate many of them in one
  dispatch.** Don't spend a whole subagent invocation on an 8-key area — collect a dozen or
  two small areas into one prompt, work through them in sequence (get slice → translate →
  merge → confirm 0 remaining → next), and report once at the end.
- **Once the remaining work has fragmented into hundreds of 1-2 key areas** (the normal
  shape of the last 10–15% of a language, where leftover keys are scattered one-per-component
  across the whole app), **stop targeting by area name.** Call `i18n-batch` with no `P=`
  filter to pull the next N missing keys regardless of area, translate that flat slice, merge,
  and repeat. Area names stop being a useful unit of work once no area has more than a
  handful of keys left — a flat pull is exactly as safe (still gated by `i18n-merge`) and
  avoids one dispatch per singleton area.
- If you are delegating to a subagent (a fork, or a fresh dispatch), **hand it the largest
  reasonable chunk of remaining work in one prompt** — many named areas, or "keep pulling
  flat batches of the current minimum for one or two rounds" — rather than one area per
  dispatch. Reserve a fresh dispatch per area only for the first few large, high-context
  areas early in a language, where extra care on one region (correct terminology carrying
  over, per-area trap review) is worth the overhead.

### 4. Feed corrections back after every batch

When a batch gets rejected, or you find a bad rendering while reviewing, **append the
correction to the glossary file** before starting the next batch. This is what makes quality
rise across a language instead of staying flat: in French, batch C caught its own mistake by
having read batch B's note. Five lines in the glossary is cheaper than the same error in
forty more keys.

### 5. Sweep for wrong-sense translations

```bash
make i18n-traps L=id
```

`make i18n` passes at 100% coverage on a German file whose unblock-everyone button reads
**"Blockieren Sie die Amnestie"** — *block the amnesty*, the exact opposite of what it does.
Coverage counts keys; it cannot read. This sweep greps for the wrong senses you wrote down in
step 2, plus any value left identical to English.

A hit is evidence, not a verdict (`Analyseskript` legitimately contains "script"), which is
why it never fails a build. Read every hit.

### 6. Verify and look at it

```bash
make i18n        # placeholder + markup parity, valid JSON, coverage report
make test        # 5,500+ specs; translations should not move any of them
```

Then **force the locale in the footer picker and walk the main surfaces.** That is the only
review that catches a button whose text no longer fits its box.

---

## Why the glossary exists

Handed `{"status.boost.action": "Boost"}` with no context, a translator — human or model —
reasonably produces the verb meaning *amplify, promote, increase*. In Chinese that can land in
the register of a municipal economic-development slogan. The word is not wrong in general; it
is wrong **here**, because `Boost` is fediverse jargon meaning "re-share someone else's post,
unmodified".

Nearly every core noun in this app has that problem. And the resulting defect is *invisible* to
a maintainer who does not read the language, and therefore permanent.

## Glossary — the words that are not what they look like

| Term | What it is NOT | What it IS | Guidance |
|---|---|---|---|
| **Boost** | amplify, promote, increase, boost a signal | Re-share a post unmodified, like a retweet | Use the locale's established Mastodon term. Both noun and verb. |
| **Post** | fence post, mail, job position, to post a letter | A status message | Use the locale's established Mastodon term. |
| **Toot** | a horn sound, a hoot | A post (Mastodon's older, whimsical word) | Keep the whimsy. Many locales keep "toot" untranslated. |
| **Handle** | a grip, to cope with, a door handle | An address like `@user@server.social` | Frequently left in English. Never "grip". |
| **Instance** / **Server** | an example, an occurrence | One server in the fediverse | Follow local Mastodon convention. |
| **Feed** | feeding, nourishment, to feed an animal | A stream of posts | Never the food sense. |
| **Timeline** | a chronology widget, a history graphic | The stream of posts you scroll | German shipped `Zeitleiste` in 5 keys against 47 correct ones. |
| **Thread** | sewing thread, a screw thread | A chain of replies | Use the discussion sense. |
| **Follow** / **Unfollow** | to come after, to pursue, to stalk | Subscribe to an account | Social-network sense only. German shipped *stalked* in 9 keys. |
| **Mute** | silent, mute button, speechless | Hide someone's posts without unfollowing | Must stay **distinct from Block**. |
| **Block** | a city block, a building block | Sever contact entirely | Must stay **distinct from Mute**. |
| **Filter** | a coffee filter, a photo filter | A rule that hides matching posts | |
| **Like** / **Favourite** | similar to, as in | Mark a post as liked | Follow local Mastodon convention. |
| **Light** (theme) | illumination, low weight | The pale colour scheme | Pairs with **Dark**. Never the lamp sense. |
| **Paste** | glue, pasta, the verb to paste | A pastebin item — a product noun here | Keep it recognisable; German shipped *pasta*. |
| **Call** (API) | a telephone call | A request to a server | German shipped *phone calls* twice, on two separate passes. |
| **Current account** | a bank chequing account | The account now in use | |
| **Fediverse** | — | The federated social network | Usually kept as a coinage. |
| **Fail whale** | a whale that failed | The error-page mascot, a joke about early Twitter's overload page | Keep the joke or find a local equivalent. **Never literal.** |
| **Starter kit** | a beginner's toolbox | A curated bundle of accounts to follow | Explain the sense; do not calque. |
| **Interface language** | — | The language of the app's own UI | Distinct from *posting language* and *known languages*, which are separate settings. Keep all three distinguishable. |

### Never translate

`Mockingbird`, `Mawkingbird` (product names), `Mastodon`, `Bluesky`, `Twitter`, `RSS`, `OPML`,
`ActivityPub`, `Raindrop.io`, `OpenRouter`, `Stripe`, `Hugo`, `@handles`, `#hashtags`, URLs,
code samples, typeface names, example domains, and anything marked `dnt` in its context entry.

### The anchor rule

**Where the target language already has an established Mastodon translation for a term, use
it.** Mastodon has been translated by humans into most of these languages. Matching their
vocabulary means users get words they already recognise, and it costs nothing. Do not invent a
new word for "boost" when the locale's Mastodon users already have one.

---

## Rules

1. **Preserve every real-data `{{placeholder}}` exactly.** Same spelling, never translated.
   Only exact allowlisted English-only vocabulary parameters may be omitted so
   the translated message supplies its inflected noun; see optional-terminology above. Reorder only
   if the target grammar demands it. A dropped `{{name}}` renders a blank where a username
   should be — the single most damaging error available. `i18n-merge` rejects it.
2. **Keep inline markup intact** — tags, entities, `&amp;`-style escapes. Also gated.
3. **Respect `max`.** A character budget for a button that will visibly break if overflowed.
   Prefer a shorter natural word over a longer literal one. Gated.
4. **Translate meaning, not words.** `"You reached the end. That's allowed here."` is a joke
   about infinite scroll and the permission to stop. Render *that*, not the sentence.
5. **Match `tone`.** `playful` stays playful; `warning` and `error` are plain, calm and
   precise. Never make a security or data-loss warning cute.
6. **Choose a formality register once, and hold it across the entire file.** This is a social
   app used casually: prefer informal (`du` in German, `tu` in French, `kamu` in Indonesian,
   ты-neutral phrasing in Russian, polite です/ます in Japanese — not keigo). Inconsistent
   register within one UI reads worse than the "wrong" choice made consistently. Record the
   choice in the glossary and gate it in `i18n-locale-rules.mjs`.
7. **Prefer gender-neutral constructions.** Strings interpolate usernames of unknown gender;
   never make the surrounding grammar assume one. Where a placeholder really is variable in
   gender, **restructure so no agreement is needed** — do not stack endings (`·e`) to dodge it.
8. **Output only the keys you were asked for.** Merge, never reorder or reformat. Translated
   files are hand-owned; no tool rewrites them, so a human volunteer's edits drop straight in.
9. **When genuinely unsure, leave the key out.** A missing key falls back to English cleanly
   (Transloco `useFallbackTranslation`). A confidently wrong translation is invisible to a
   maintainer who does not read the language, and therefore permanent. **Omission is the safe
   failure; guessing is not.** This is about *terminology you don't know* — not about a string
   that merely embeds a code sample or a URL, which should still be translated around.
10. **Never invent terminology-setting vocabulary.** The post/tweet/florp/skeet/toot picker is
    an **English-only feature by decree** — non-English locales use the canonical noun only.
    Do not attempt a German "florp". Those keys are already excluded from the work order.
11. **Never build a sentence by concatenation, and never `.replace()` display text.** If the
    English does either, that is a source bug: fix it with one whole key per variant plus
    `{{params}}`, rather than translating around it.

---

## Per-language notes

Append what you learn here; the next fifty languages inherit it.

### Indonesian (`id`)
- No grammatical gender, no verb agreement, **no plural inflection**. Rule 7 is free. Do not
  reduplicate (`postingan-postingan`) to render an English `-s` — it means *various assorted
  posts*. ICU plurals need only an `other` category.
- Register: `kamu`, never `Anda` (gated). Dropping the pronoun entirely is neutral, not a slip,
  and often the most natural choice.
- Runs ~15–20% longer than English; `max` is binding. The `-mu` enclitic (`akunmu`) buys space.
- Established terms: linimasa (timeline), utas (thread), markah (bookmark), bisukan (mute),
  blokir (block), Terang/Gelap (Light/Dark theme).

### German (`de`)
- Compounds overflow buttons — the most common `max` violation.
- Use `du`, not `Sie` (rule 6). Third-person *sie/ihre* is legitimate, so a naive `/\bSie\b/`
  probe has a real false-positive rate; the gate matches capitalised `Sie` mid-sentence only.
- Wrong senses that actually shipped: Anruf, verfolgen, Zeitleiste, Licht, Pasten, Girokonto,
  Faden, Futter, Griff, a literal Wal.

### French (`fr`)
- Narrow no-break space **U+202F** before `: ? ! ;` — not a regular space, not nothing. Gated,
  with `<code>`, URLs and entities exempt.
- Typographic `’`, never ASCII `'`. Gated.
- Informal `tu`, zero `vous` across 5,718 keys. Gated.
- Never `·e` inclusive endings — `{{post}}` holds the English-only terminology noun and is
  therefore always masculine. Restructure instead (rule 7).

### Russian (`ru`)
- Runtime `Intl.PluralRules('ru')` reports cardinal categories `one/few/many/other`.
  Fractions are numbers to test, not extra category names. Derive categories from
  the selected locale and cardinal/ordinal mode; do not assume the existing gate
  checks plural completeness.
- Past-tense verbs agree with subject gender. `{{name}} boosted` would force a gender guess —
  restructure to a gender-neutral form instead.

### Finnish (`fi`)
- 15 cases; compounds get very long. **`max` is binding, not advisory.**
- No grammatical gender — easy for rule 7.

### Icelandic (`is`)
- Smallest training corpus of the day-one languages: **the highest-risk language here.** Apply
  rule 9 more readily than elsewhere.
- Strong purist tradition — prefer native coinages over English loanwords where one exists.
  (This is the opposite of the Indonesian strategy; do not carry one language's instinct into
  another.)
- Four cases, three genders; watch agreement around interpolated nouns.

### Japanese (`ja`)
- No plurals and no spaces. Watch line-breaking in narrow columns; long unbroken runs overflow.
- Counter words vary by noun class.
- Polite です/ます, not keigo, not plain form.

### Swedish (`sv`), Spanish (`es`)
- Well-supported, few traps. Still hold the register and glossary rules.

---

## Done checklist

A locale moves from `IN_PROGRESS_LOCALES` to `PRODUCTION_LOCALES` when **all** of these hold:

- [ ] `make i18n-batch L=xx --areas` reports 0 remaining
- [ ] `make i18n` passes — no placeholder, markup or JSON errors
- [ ] `make i18n-traps L=xx` reviewed, every hit judged (not merely run)
- [ ] `make test` green — a translation should not move a single spec
- [ ] the glossary file exists, with its corrections log filled in
- [ ] someone forced the locale in the footer picker and walked home, a profile, settings,
      compose and one connector page

Coverage alone is never the criterion. A file at 100% coverage can still tell a reader that
the unblock button blocks the amnesty.

---

## Files

```
src/app/i18n/locale.ts              PRODUCTION_LOCALES / IN_PROGRESS_LOCALES / endonyms
public/i18n/en.json                 GENERATED from `// i18n` comments — never hand-edit
public/i18n/<lang>.json             hand-owned; only i18n-merge writes it
i18n-context/en.context.json        the translator's brief: desc/surface/max/tone/glossary/dnt
i18n-context/glossary-<lang>.md     this language's locked terminology + corrections log
scripts/i18n-locale-rules.mjs       per-locale merge gates and trap words
scripts/i18n-merge.mjs              the gate — the only writer
scripts/i18n-batch.mjs              next slice of missing keys
scripts/i18n-traps.mjs              wrong-sense sweep
scripts/i18n-todo.mjs               the full work order (the spec; too big to hold at once)
```
