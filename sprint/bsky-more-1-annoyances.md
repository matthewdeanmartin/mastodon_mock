# Bluesky Sprint — "Need more bsky!!!!"

Six asks, worked in phases. This file tracks what is done and what is not, so an
unfinished phase can be handed off.

Source asks, verbatim:

1. add images!
2. add account with bsky alts (`?add=1` from the account-switcher dropdown) —
   "I'm okay with Add new Mastodon and Add new Bsky"
3. bsky default when bsky is the main account
4. hide bsky connector when bsky is primary, hide mastodon connector when
   mastodon is primary
5. the sync experience — re-pasting the app password on phone, browser, second
   browser
6. (from the images answer) "I can't attach an image" in the mini composer

---

## Phase 1 — the daily annoyances ✅ DONE

All shipped, `ng build` clean, `ng lint` clean, **5268/5268 tests pass**.

### Bluesky default when Bluesky is the account (ask 3) ✅

`compose.ts` seeded `target` to `'fedi'` unconditionally. A Bluesky-primary
account therefore opened every composer aimed at Mastodon — the one network they
are not — so posting where they live took a correction every time.

Now falls through to `restorableTarget('bsky', …)` when `auth.isBlueskyPrimary`.
Via `restorableTarget` rather than a bare `'bsky'` so stale credentials degrade
to Fedi instead of opening on an unusable target. Both branches pinned.

### Hide the self-connector (ask 4) ✅

Mastodon-under-Mastodon already rendered greyed with "it is your account here,
not a connector". Bluesky-under-Bluesky had no handling at all.

Both now **removed from the list** (`isOwnIdentity` in
`settings-connections.ts`). The asymmetry is deliberate and documented: a
flagged-off or unconfigured connector keeps greying, because that is a real
offer that could become available. "You are signed in already" never resolves
while the account is active, so it was permanent furniture explaining an
impossibility, directly above the connectors the reader came for.

Anonymous is deliberately excluded from the Mastodon rule — it reads a Mastodon
server, but the row still offers a real choice (*which* server).

### Bluesky credential sync (ask 5) ✅ — a reversed decision

**This overturned a deliberate, documented, test-pinned call.** Both Bluesky keys
were in `NOT_VAULTED` with the reason *"a Bluesky app password is re-issued in
under a minute. Identity, not a purchase"*, and the pinning test's comment said
"this makes reversing it loud". It was reversed on the reader's explicit
decision. The argument:

- The old reason measured the cost **once**, not once per device. The failure was
  loudest for exactly the user who had turned sync on, watched every other key
  arrive, and found Bluesky still asking.
- It mis-filed the credential. An app password is a **revocable, per-app
  credential the user obtained by hand** — the same shape as every other key in
  `VAULTED_KEYS` — not an identity token like Mastodon's OAuth token, which stays
  out. Bluesky offers no PKCE flow, so there is no cheap re-auth to fall back on.
- The exposure argument inverted on inspection: the app password *already* had to
  travel between devices, through a password manager or a note. Vaulting it
  removes a hand-copied secret rather than adding a synced one.

What travels is the **app password only, never the JWTs**. Tokens rotate on every
refresh, so two devices sharing a pair would invalidate each other in a loop. The
receiving device mints its own session.

Implementation: `appPassword` added to `BskyCredentials` (the secret half),
explicitly `Omit`ted from `BskyProfile` (the exportable half), written through
`VaultBridge` on login, read back via `vaultedCredential()`.

One bug caught by its own test during development: `persist()` is also the
refresh and PDS-discovery path, and the in-memory session carries `appPassword`
forward — so a naive `if (appPassword)` vaulted on **every token refresh**. Now
compares against what is already stored, so a write happens on a real login and a
password rotation, and nowhere else.

### Tests added

- `bluesky-session.spec.ts` (new, 9 tests) — vault round-trip, locked-vault
  fallbacks, no-JWTs-in-vault, no-churn-on-refresh, re-write on rotation.
- `settings-connections.spec.ts` — the own-network rules, both directions.
- `compose.spec.ts` — Bluesky-primary default plus its degradation.
- `login-bluesky.spec.ts` — rewritten: the invariant that mattered (no credential
  in the exportable half) is kept and strengthened; "app password stored nowhere"
  is replaced by "app password in the secret half only".
- `vault-manifest.spec.ts` — new rationale recorded on the identity-token
  exclusion; nine live credentials became eleven.

---

## Phase 2 — add a Bluesky account (ask 2) ⬜ NOT STARTED

`shell.ts:447` already carries the note: *"Adding a Bluesky identity is Sprint 3's
job and will get its own entry point."* This is that entry point.

Today `addAccount()` hard-navigates to `login/mastodon?add=1`, past the chooser,
because the button lives in the Mastodon switcher. The reader is happy with two
explicit items — **Add new Mastodon** and **Add new Bsky** — rather than a
network chooser.

Known ground:

- `login-chooser` already exists and already understands `?add=1`
  (`login-chooser.ts:23`).
- `loginAsIdentity` already writes to the unscoped identity keys and deliberately
  does not set the account-kind key, so an abandoned login cannot leave the app
  claiming to be signed in.

Open question to settle first: `bluesky-identity-store.ts:18` states there is **at
most one Bluesky-primary account per browser**, keys as singletons. "Bsky alts"
implies several. Turning those into keyed records is named there as the growth
path, but it is real work and it is the thing to scope before writing UI.

## Phase 3 — images (asks 1, 6) ✅ DONE

`ng build` clean, `ng lint` clean, **5285/5285 tests pass** (17 new).

### The bug behind "I can't attach an image"

Not a missing button. `canAttachMedia()` never consulted the target, so the 📎
was live and a file could be picked — then `canSubmit` returned `false` for
`target === 'bsky'` with media attached and **the submit button silently went
dead**, explained only by a muted grey hint elsewhere on screen. The same
silent-refusal pattern the code already flags as a past bug for threads
(`compose.ts:2126`). The reader's report was accurate.

### The architectural crux

`PendingMedia` held only the `MediaAttachment` returned by Mastodon's upload —
**the original `File` was discarded**. Bluesky cannot reuse that upload: its
`uploadBlob` wants the bytes, in its own repo, under its own ceiling. So the
first change was retaining the file.

Second consequence: a Bluesky-**only** post no longer uploads to Mastodon at all.
It used to spend a Mastodon API call and store a file nothing would ever
reference. Those attachments are held locally behind an object URL (`localMedia`)
so the preview and alt-text editor still work, and the URLs are revoked on remove
and reset — four phone photos pinned for the life of a tab is real memory.

### What shipped

- `bluesky-image.ts` — the downscaler. Passes small images through untouched;
  otherwise walks a quality ladder at 2048px, then shrinks and repeats, targeting
  950KB against Bluesky's 1,000,000-byte ceiling. Gives up rather than uploading
  something that will be refused.
- `BlueskyApi.uploadBlob` — the one XRPC procedure taking a binary body. Goes
  through the existing `request` path, so it inherits expired-token refresh.
- `BskyBlobRef` / `BskyImagesEmbed` write-side types, kept distinct from the
  read-side `BskyEmbedView` (blob refs vs hydrated CDN URLs — conflating them is
  how an embed that looks right fails to publish).
- Upload-then-post ordering: blobs must exist before the record referencing them.
  If any upload fails, **nothing is posted** — a post that silently dropped one
  of four photos would leave the reader to notice after publishing.
- Alt text carried into the embed from the composer's existing editor.
- Images attach to the first post of a thread only.
- Limits enforced at pick time with a notice attached to the action: images only,
  four maximum. Switching target after attaching says so too
  (`noteBlueskyMediaLimits`).
- The dead-button rule is gone. Polls remain refused — the protocol has no poll
  record — and that is now stated as its own reason rather than lumped in.

### Verification limits

The mock server implements no AT Protocol, so Bluesky calls go to the real
`bsky.social`. Unit tests cover the ladder's decisions, the request shapes, the
embed contents and the failure paths (the three embed assertions were checked to
fail without the wiring). **Whether a real photo from a real phone lands in a real
Bluesky post is not covered and needs your account to confirm.**

### Still open in this area

- The `both` target uploads each image twice — once to Mastodon, once to Bluesky.
  Correct, since they are different repos, but it doubles the wait on a phone and
  there is no progress indication for the Bluesky half.
- No retry on a partial multi-image upload: three of four succeeding still aborts
  the whole post, and the three blobs are orphaned in the repo. Bluesky garbage-
  collects unreferenced blobs, so this leaks nothing permanently.
- `PendingMedia.file` is absent for attachments restored from a draft, so a draft
  with images reopened later cannot post them to Bluesky. It will fall back to
  posting the text.

## Phase 3 (original plan) — superseded by the above

The reader's framing: *"we want it to work"* — not a better apology.

**Ask 6 is a real bug, and worse than it looks.** In the composer,
`canAttachMedia()` does not consider Bluesky, so the 📎 is enabled and a file can
be picked. Then `canSubmit` (`compose.ts:996`) returns `false` for
`target === 'bsky'` with media attached — **the submit button silently goes
dead**. The only explanation is a muted grey hint elsewhere on screen
(`compose.html:730`). This is the same silent-refusal pattern the code already
flags as a past bug for threads (`compose.ts:2126`).

Scope:

- `uploadBlob` on the AT Protocol side, then an `app.bsky.embed.images` embed on
  the record. `postBskyPart` currently sends text + facets only.
- **Downscale in the browser before upload** (reader's choice). Bluesky caps
  images at ~1MB, max 4 per post; phone photos are routinely 3–5MB, so without
  this the feature is unusable on the device it matters most on.
- Alt text: the composer already has an accessibility gate
  (`compose.ts:944`) and Bluesky supports alt on image embeds, so wire it rather
  than dropping it.
- Once upload works, delete the `canSubmit` refusal and the "text-only" hint
  instead of rewording them.

API failures still need reporting — that is not in dispute — but the deliverable
is a working attach, not a clearer refusal.

---

## Not asked for, noticed while working

- `search-helper.ts` briefs the AI helper that account search has no operators.
  Corrected in the previous batch, noted here because the same "read the docs,
  not the code" error produced it.
- No `bluesky-session.spec.ts` existed before this sprint. There is one now, but
  it covers vault sync only — login, refresh, retention and the identity/connector
  key split are still untested at the unit level.
