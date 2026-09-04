# Kindle 3 — Reading tools: vocabulary, search, highlights, notes

Status: **COMPLETE** (2026-09-04)
Epic: [[kindle-0-overview]]
Depends on: [[kindle-2-library-and-progress]]

Goal: the four tools that make the reader a reading device rather than a clean
page — look up a word, find a passage, mark a passage, keep a note — plus the
failing-host learning the brief asked for.

## 3a. Vocabulary: select a word, look it up

Selecting a **single word** in the article body raises a small popover anchored
to the selection offering `Define`. Selecting more than one word does not — that
is the highlight case (3c), and offering both on every selection makes each one
harder to hit.

"Single word" means: the trimmed selection contains no whitespace, is at least 2
characters, and is letters-only under a Unicode letter class (so hyphenated and
accented words work, and a selected URL or number does not trigger it).

**The lookup is an intent, not an API.** Per the brief, `Define` opens a
dictionary site in a new tab. No key, no quota, no CORS proxy, nothing to fail.

Provider is a preference, `readerDictionary`, with a small registry in
`providers/read/dictionaries.ts` shaped like the existing service catalogues
(`cors-proxy-catalog.ts`, the shortener registry):

```ts
{ id: 'wiktionary', label: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/{word}' }
{ id: 'merriam',    label: 'Merriam-Webster', ... }
{ id: 'custom',     label: 'Custom…', /* user-supplied {word} template */ }
```

Default: Wiktionary — free, no paywall, no account, and it has entries in the
reader's own language when the document is not English.

**Language matters.** The document's detected language (`language-detect.ts`
exists) picks the Wiktionary subdomain when we have one. A reader looking up a
German word should not land on the English entry.

`{word}` is URL-encoded at substitution. A custom template is validated to be
http(s) and to contain `{word}` before it is saved.

## 3b. In-document search

A compact toolbar button opens a search dialog over the document.

Searches the **whole document**, not the current page — searching one page of a
twelve-page article is a bug wearing a feature's clothes. Matches are counted,
listed with a line of surrounding context and their page number, and clicking
one navigates to that page with the match scrolled into view and marked.

Implementation: search the source markdown, not the rendered DOM. The markdown
is what `article-pages.ts` already slices, so a match's page is a lookup rather
than a measurement, and it survives re-pagination. Case-insensitive substring;
no regex — a reader typing `(` should get the paren, not a syntax error.

`Ctrl/Cmd+F` opens it, preventing the browser's own find, which would only ever
search the visible page anyway.

## 3c. Highlights

Selecting **more than one word** raises the popover with `Highlight`, `Note`,
and `Share`. Share is not new work: `share-dialog/share-selection.ts` already
captures a container-scoped selection with both traps solved (read before the
dialog opens; reject selections that stray outside the container). Wire to it.

### Anchoring

Highlights anchor to the **extracted markdown**, which is ours and stable,
rather than to the live remote DOM. An anchor is:

```ts
interface Anchor {
  /** Index of the top-level block in the document's block list. */
  block: number;
  /** Character offsets within that block's plain text. */
  start: number;
  end: number;
  /** The text as highlighted, for verification on restore. */
  quote: string;
}
```

On restore, `quote` is checked against what is at those offsets. If it does not
match — the site rewrote the article, or the extractor changed — the highlight
is **not** rendered in place; it is kept, shown in the notes rail marked
"passage moved", and the reader can still read their own note. Silently
highlighting the wrong sentence is worse than admitting the anchor drifted.

Storage: `providers/read/reader-annotations.ts`, keyed by document id, same
tolerant-load and account-scoped pattern as the library. Registered in
`storage-registry.ts`. A note's body is user content the reader wrote — it is
`cache` retention like the rest, but it must be included in export.

## 3d. Notes and the right rail

A highlight may carry a note. `Note` on the popover opens a small composer;
`Highlight` alone stores an empty-noted highlight.

The rail appears **only when the document has at least one note**, per the
brief — an empty rail on every article is a permanent tax for an occasional
feature. When present it sits to the right of the measure, narrow, showing each
note against its quote in document order, with the current page's notes
emphasised. Clicking a note jumps to its passage.

Below the measure instead of beside it under ~1100px, since a rail plus a 68ch
measure does not fit on a phone. The reading column never narrows to make room
for the rail — the measure is the point.

"Share to repost" from a note composes with the quote, through the existing
share dialog.

## 3e. Failing hosts: starter list plus local learning

The brief: start with a starter list of paywalled newspapers, add local
learning, keep an LRU. The starter list **already exists** —
`article-diagnosis.ts:29`, `UNLIKELY_HOSTS`, carrying nytimes, wsj, ft,
economist, bloomberg, newyorker, theatlantic plus the login-wall hosts, each
with a `why` and a comment explaining that entries are hints rather than blocks
("Try anyway" rather than a missing button). That design is right and stays.

This sprint adds the observed half: `providers/article/observed-failures.ts`.

- Records, per host: attempts, failures, the last diagnosis, last seen.
- **LRU-bounded**, ~200 hosts, evicting least-recently-seen. A map of every
  host a reader ever touched is unbounded by construction.
- Only *host-attributable* diagnoses count as failures: `paywall`, `bot-check`,
  `consent-wall`, `needs-js`, `blocked-destination`, `site-rate-limited`. A
  `network` or `rate-limited` verdict is about us or the moment, not the
  publisher, and must not poison a host's record.
- After 3 failures with 0 successes, the pre-fetch check warns before spending
  quota — same "Try anyway" wording as the shipped list, so the two sources are
  indistinguishable to the reader. A single success clears the record: the
  evidence is that it works.

Exportable as JSON from storage diagnostics, so the list can be read and pasted
into `mawkingbird_cors_proxy`'s own table later. **Nothing is sent anywhere in
this sprint** — the proxy-side collection is future work named in
[[kindle-0-overview]].

## Acceptance

- Selecting one word offers Define and opens the configured dictionary in a new
  tab with the word encoded; selecting a phrase offers Highlight/Note/Share
  instead.
- A German-language document sends Define to the German Wiktionary.
- Search finds matches on pages other than the current one, reports their page,
  and navigating to one marks it.
- Ctrl/Cmd+F opens in-document search, not the browser's.
- A highlight survives closing and re-opening the document; a highlight whose
  quote no longer matches is listed as moved rather than drawn in the wrong
  place.
- The notes rail is absent on a document with no notes, and present on one with.
- Three `paywall` verdicts on a host trigger the warning; a subsequent success
  clears it; a `network` failure never contributes.
- The observed-failure store never exceeds its LRU bound, tested by overfilling.
- `make storage` and `make i18n` pass; `make check` passes.

## Traps

- **Selection popovers and page turns.** Turning the page with a selection live
  leaves an anchored popover pointing at nothing. Clear the selection and
  dismiss on any page change.
- **`selectionWithin` is container-scoped for a reason.** Pass the article body
  element, not the page — a selection in the notes rail must not become a quote
  from the article.
- **Highlight rendering must not go through `innerHTML` on user text.** The
  markdown renderer is the security choke point (`html-to-markdown.ts` says so
  explicitly); marking a range means wrapping nodes in the already-sanitised
  output, never re-serializing user-supplied strings into HTML.
- **`Ctrl+F` interception is hostile if the reader wanted the browser's.** Only
  intercept on the reader route, and only when the document actually paginated.

## What was built

All five sections, plus two things the sprint assumed existed and did not.

### 3a — vocabulary

`providers/read/dictionaries.ts` holds the registry, shaped like
`shortener-catalog.ts`. Wiktionary (default), Merriam-Webster, Dictionary.com,
and a custom `{word}` template validated for http(s) *and* for containing
`{word}` before it is saved — a template missing the placeholder silently opens
the same page every time, which reads as a broken feature rather than a bad
setting.

Language comes from `detectLanguage` over the article text rather than from a
declared tag, because an article's language tag is frequently the *site's*: a
German post on an English platform is tagged `en` and is still German. Sixteen
Wiktionary editions are listed — the large ones only, since a subdomain with a
few thousand entries is a worse destination than the English one.

The provider picker lives in the reader's typography popover rather than in
Settings: it is a reading control, and the reader is where anyone discovers they
want to change it.

### 3b — in-document search

`document-search.ts` searches the paginated markdown, so a match's page is a
lookup. Case-insensitive substring with whitespace collapsed on both sides, so a
phrase still matches when the source wrapped it. Capped at 200 matches. Not a
regex, deliberately: a reader typing `(` wants the paren, not a syntax error.

`Ctrl/Cmd+F` is intercepted **only when the document actually paginated**. On a
single-page document the browser's own find is the better tool — it marks every
hit live — and taking it away would be hostile for nothing. Three tests cover
exactly that boundary.

### 3c/3d — highlights, notes, and the rail

Anchors index blocks of the **document**, not of the page, so they survive a
type-size change. `article-pages.ts`'s `blocks()` was exported rather than
duplicated: two definitions of "a block" would let an anchor point at a
different paragraph than pagination put on the page.

The quote check works as specified — a drifted anchor is listed in the rail as
"passage moved" with the reader's words intact, and is never drawn in the text.

The rail appears only when a note has been *written*. A bare highlight is not a
note: someone marking passages as they read asked for marks in the text, not a
column beside it.

**`mark-passages.ts` is where the security trap was.** It never builds HTML from
user text: it walks the rendered DOM and wraps existing nodes with
`surroundContents`/`extractContents`. There is no injection point to get wrong,
which is stronger than sanitising one. Two tests assert it directly — a quote
full of angle brackets, and one crafted to inject an attribute.

### 3e — observed failures

`providers/article/observed-failures.ts`, LRU-bounded at 200 and tested by
overfilling. Only host-attributable verdicts count; `network` and `rate-limited`
are facts about us or the moment, and `junk`/`not-html`/`too-large` are facts
about one URL — one PDF does not make a domain unreadable. A single success
clears the host outright rather than decrementing it, because the evidence is
that it works.

## Two things the sprint assumed were shipped

Worth recording, because the doc was written as though both existed.

**`UNLIKELY_HOSTS` and `inspectUrl` were dead code.** Nothing called them. The
"same 'Try anyway' wording as the shipped list" therefore described a surface
that had never been built. Rather than invent a second one, `beforeFetch()` now
folds both sources into a single answer — the shipped list first (it is
reviewable, works on the first attempt, and knows things experience cannot, like
a PDF never extracting), then what this device has seen. Which is what actually
makes them indistinguishable to the reader.

**There is no Storage Diagnostics surface** consuming `prunedOnLoad` or an
export. `exportJson()` and `snapshot()` are built and tested and wait for one;
`ReaderLibrary.prunedOnLoad` has been in the same position since Sprint 2.

## Deviations

**The notes rail's Share goes through an output, not a dialog.** `ReaderCore`
has no share dialog — the RSS pane owns one, and now the read page does too. Two
dialogs on one screen would be two things that could be open at once, so the
core emits `shareQuote` and the host decides.

**Selection is caught at the document, not on the article body.** A `(mouseup)`
on the prose trips `interactive-supports-focus`, and it is right to: an element
with interaction handlers ought to be focusable, and making prose a tab stop
would put a focusable element with no purpose in front of every keyboard reader.
Both listeners check the selection is inside the body before acting, so the
container scoping the sprint insisted on is unchanged.

**The toolbar output is `findInDocument`, not `search`.** A bare `search` output
shadows the DOM event of that name.

## Test coverage

126 new tests: dictionaries 18, document-search 12, reader-anchor 12,
annotations 18, observed-failures 20, mark-passages 10, reading-tools 18,
selection-tools 6, search dialog 8, notes rail 7, plus 3 for Ctrl+F on the read
page (which fail if the interception is removed or widened).
