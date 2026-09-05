# Independent Taiwan translation review — 2026-09-05

## Follow-up: directly authored redo 01 and 02

Astra read all 600 replacement values against English and checked ambiguous
call sites. Quality is substantially improved. **565 exact values approved;
35 require bounded corrections** in `ui/tmp_zh_corrections_01_02.work.json`.
The approved flat file is `ui/tmp_zh_approved_01_02.json`; its source snapshot is
`ui/tmp_zh_review_source_01_02.json`, combined from the unchanged originals.
The 35 correction entries are marked rejected/stale. Remaining ledger counts:
4,054 missing, 1,235 stale, zero unreviewed, 565 reviewed.

Corrections cover assembled fragment grammar, omitted distinct source details,
remembered blog versus account, unverified versus currently under review,
comparison probes, rolling-year filters, ranking and follow-policy senses,
post counters, and glossary consistency for followers/mutuals. No blanket redo
is needed for these 600. Correct only the 35 listed keys, then Astra rechecks.

Ledger re-acceptance already cleared initial rejection correctly. Fixed one
additional edge case: resubmitting a later-rejected revision must never revive
an older approval hash. Two ledger regression tests pass including that case.
No source templates changed and no full UI gate ran in this follow-up.

## Original rejected machine-translated draft

Astra inspected all 1,800 unique English/draft pairs in six 300-key batches:
01, 02, 07, 08, 09, 10. Batches 03–06 repeat 02 and are not new work.
Decision: **all six batches require contextual retranslation; zero approved**.
Some short labels and literals are individually reasonable, but pervasive wrong
senses, regional/register inconsistency, damaged copied syntax and untranslated
prose require complete batch redo rather than vocabulary patching. This is not
a finding that every individual string is wrong.

## Evidence of the failed method

Retained `ui/translate_tmp.cjs` sends English strings to
`translate.googleapis.com/translate_a/single` using `client=gtx`, `sl=en`,
`tl=zh-TW`. It groups ten entries with newlines, maps response lines positionally
back to keys, and falls back to English for empty results. Do not execute it.
The glossary's earlier advice about normalizing automated drafts has been removed.
The translate-ui skill now prominently prohibits this workflow under explicit
user direction. Luna must directly author translations.

## Batch findings

| Batch | Keys inspected | Values identical to English, including legitimate literals | Representative failures |
|---|---:|---:|---|
| 01 | 300 | 7 | composer → 作曲家; Optional → 選修的; Mastodon → 乳齒象; feed → 餵食; literal x-api-key → x-api-密鑰 |
| 02 | 300 | 76 | Match on → 比賽開始; min → 分分鐘; BOT → 資本運作; Mutuals → 互助基金; bios → BIOS |
| 07 | 300 | 53 | Draft → 吃水; Branch → 分公司; main → 主要; content/posts → 內容/嘟文; Gist scope → 重點 |
| 08 | 300 | 58 | Thread position → 螺紋位置; What are you looking for? → 你要買什麼？; Collapse repeated → 反覆崩潰; Top-level posts → 頂級職位 |
| 09 | 300 | 27 | Credits → 製作人員; key OpenRouter issues → 關鍵的 OpenRouter 問題; Refreshing → 清爽; Following… → 繼… |
| 10 | 300 | 85 | Board → 董事會; CW → 連續波; shortening → 起酥油; Boost → 升壓; parked post → 停放的柱子; multiple Simplified Chinese strings |

The 306 identical values include names, URLs, numbers and placeholder-only values
that should remain unchanged. They also include many full untranslated sentences,
including `pages.search.accountHelp.intro`, `pages.search.empty.refused`,
`settings.connections.github.credentialWarning`,
`settings.connections.mataroa.proxyConsent`, and `pages.write.sendsTextTo`.
English prose must not be inserted simply to pass structural checks.

## Call-site checks and source issues

- `connections/bluesky/connection-bluesky.html` renders `expiresOn` with a future
  expiry label. The draft incorrectly says tokens have already been deleted.
- `connections/cors-proxy/connection-cors-proxy.html` uses
  `headerNamePlaceholder` as a header-name example. `x-api-key` must stay literal.
- `connections/hugo/connection-hugo.html` uses `branchPlaceholder` and
  `postsFolderPlaceholder` as repository inputs: preserve `main`, `content/posts`.
- `pages/search/account-result-card.ts` returns `card.mutuals` for a mutual-follow
  relationship; this is not a financial fund. The template's `card.bot` is an
  automated-account badge, not a financial acronym.
- `pages/write/split-modes.ts` exposes `splitMode.rule.label/noun` for the actual
  `---` separator. Replacing it with a Chinese dash misdocuments the syntax.
- `connections/blogger/connection-blogger.html` puts a blog name before
  `stillRemembered` and an interactive CORS proxy link between `profile.hint.a/b`.
  These need Astra's sentence restructuring. Do not translate isolated fragments
  without reconstructing their complete rendered sentence.
- `connections/openrouter/connection-openrouter.html` splits credential warnings
  around static `openrouter.ai` and model help around model IDs. Other concrete
  fragment groups in the redo sets include Blogger OAuth setup, Bluesky link
  hints, Gist intro/warnings, Hugo permissions instructions, connection-doctor
  explanations, and Twitter import/limit/proxy summaries. They remain a separate
  Astra source follow-up; no broad source migration was attempted during rejection.

## Exact redo work and acceptance

The six workfiles are `ui/tmp_zh_redo_01.work.json`, `02`, `07`, `08`, `09`, `10`
with the same filename pattern. Each contains exactly 300 unique keys, current
English, context, rejected draft evidence and the original source snapshot path.
These are work orders, not merge inputs. Author fresh flat translation JSON.
The accompanying `tmp_zh_source_XX.json` snapshots still match current source.
Never use the rejected drafts as an approved translation memory.

All 1,800 ledger entries carry `reviewRejected` pointing to this report. Work
selection treats them as stale, and review stamping refuses them until a fresh
accepted submission clears that rejection. Existing source/translation hashes
and locale values remain as evidence; no bad text received an approval stamp.
There are 4,054 missing + 1,800 rejected/stale = 5,854 unfinished eligible keys.

After each contextual rewrite, merge using its original source snapshot, then
have Astra independently inspect the complete 300-key batch again. An unchanged
short label may be retained only after contextual judgment; no whole-batch
mechanical pass or unchanged re-merge is an acceptable correction.

Validation: workfile generator checked 1,800 unique keys, exact accepted values,
snapshot hashes and prior unreviewed ledger state. Ledger tests cover rejection
being offered as stale and refusal of review stamps. No full UI gate was run.
