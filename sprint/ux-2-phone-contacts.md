# UX Sprint — Finding people from phone contacts

Status: **SHIPPED** (researched and built 2026-08-23)

Raised as part of the first-five-minutes batch:

> "Some way to integrate with phone contacts from website?"

The research below recommended deferring. **That recommendation was overruled, correctly:**

> "This is going to be name matching. We have done this before, see other attempts at
> account correlation. The poor user with a friend named John Doe is going to get bad
> matches, but if their friend is Freedbling Flingerblam, then this will be great. So
> we're not going to give up because it won't work for all contacts. This was true for
> phone number matching too. The user has to click follow, nothing is automatic."

That is the right call and the research had weighted the wrong thing. A match that is
*shown, explained, and acted on only by the reader's own click* does not need to be
reliable to be valuable — it needs to be honest about its confidence. This repo had
already solved that problem four times over in `bridge-matching.ts`,
`contact-discovery.ts`, `github-friend-discovery.ts` and `twitter-friend-discovery.ts`,
all of which rank by explained signals and never follow anyone automatically.

## What shipped

**Almost nothing new.** `contact-discovery.ts` already contained the entire engine — CSV
parsing, multi-signal ranking, an API budget, rate-limit handling, sequential search with
courtesy delays, and a results UI with per-account Follow buttons. It only lacked a second
way to get contacts *into* it.

- **`contact-picker.ts`** (new) — wraps `navigator.contacts.select`, converts the
  selection into the same `SearchableContact` shape the CSV path produces, caps a run at
  `MAX_PICKED_CONTACTS` (20).
- **`buildSearchableContact()`** (extracted from `contactFromRecord`) — the shared seam,
  so the CSV importer and the picker cannot drift on what counts as a usable contact or
  how search terms are derived from one.
- **`ContactDiscovery.loadContacts()`** — accepts already-parsed contacts; `load(text)`
  now delegates to it.
- One button on the import/export page, rendered only where the API exists, plus a
  `#contacts` anchor and a **"Look for your contacts"** row on `/find-friends`.

Everything downstream — budget, ranking, signals, Follow — is the code that was already
there.

### The John Doe case, as a test

`rankMatch` already grades a bare display-name match as `weak` on purpose, with the
comment "the world has many people called Alex". `contact-picker.spec.ts` pins both ends:
"Freedbling Flingerblam" produces an explained match, "John Doe" produces `weak`. Neither
is followed without a click.

## The original research

Kept below, because the constraints it documents are all still true — they are why the
shipped version is name-only, and why it must never grow a server component.

## The short answer

**The browser half is easy. The matching half is impossible without building something
this project has so far refused to build.**

A web page can read the user's contacts on roughly one browser. It cannot turn a name or
a phone number into a Mastodon handle, because no such lookup exists on the network by
design. Anything that closes that gap is a server that ingests address books.

## What the browser can do

The [Contact Picker API](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API)
(`navigator.contacts.select`) exists and works:

```js
const supported = 'contacts' in navigator && 'ContactsManager' in window;
const chosen = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: true });
```

Its properties are genuinely good — better than the native equivalents:

- **The picker is the browser's, not ours.** The page never sees the address book, only
  the entries the user tapped. There is no "grant access to all contacts" moment.
- **Nothing persists.** Permission is per-invocation; there is no standing grant to
  revoke later.
- **Requires HTTPS, a top-level frame, and a user gesture.** All three are satisfied
  here.

### The support problem

MDN classifies it **"Limited availability — not Baseline, does not work in some of the
most widely-used browsers."** In practice: **Chrome on Android 80+ only.** Not desktop
Chrome. Not Firefox. Not iOS Safari, which is the entire iPhone install base, since every
iOS browser is WebKit underneath.

For a static web client with no app store presence, that is a feature most users cannot
see. It is not a reason to refuse — progressive enhancement is normal — but it is a reason
not to spend a sprint on it before the matching problem is solved, because the matching
problem is the one that makes it useless.

## Why matching is the real blocker

Having a name and a phone number, there is no way to find that person on Mastodon.

- **`/api/v1/accounts/search`** searches username, display name and bio. Not email, not
  phone.
- **`/api/v1/accounts/lookup`** takes `acct` — a handle or WebFinger address. You must
  already know the handle.
- **Email/phone lookup exists only in
  [`/api/v1/admin/accounts`](https://docs.joinmastodon.org/methods/admin/accounts/)**,
  which requires instance-admin credentials over that instance's own users.

This is deliberate. Mastodon
[declined the feature](https://github.com/mastodon/mastodon/issues/4186) and the position
has held: discovery-by-identifier is how Twitter and Facebook made every user findable by
anyone holding their number, and the fediverse chose not to have that.

So the only usable field is **name**, matched against display names by string similarity.
Which fails for the ordinary reason that Mastodon handles and display names are usually
not real names — the same person is `@birbnerd` in your feed and "Sarah Chen" in your
phone, and nothing connects them.

### What the "real" version would require

Every product that does this well runs a server that ingests hashed contact identifiers
and matches them against hashed identifiers of registered users. That means:

1. A server that receives the user's address book (hashed or not — hashing phone numbers
   is [famously weak](https://cloudsecurityalliance.org/blog/2022/11/15/mastodon-user-discovery-and-verification-via-email-the-easy-way):
   the space is small enough to brute-force every number in a country).
2. Users opting **in** to being discoverable by that identifier.
3. That store being a permanent, high-value target holding a social graph of people who
   never used this app at all — the contacts of users, not users.

That is directly against `mawkingbird_profile`'s stated posture, which refuses to store
anything `secret`, turns off invocation logs so a person's reading is not recorded, and
keeps the server unable to read the vault. A contact-matching service is the opposite
document.

**Recommendation: do not build the server. If contacts ship at all, they ship as the
weak client-only version, honestly labelled.**

## If it ships anyway: the honest version

A single button, only on browsers that support it, doing exactly what it says.

### Shape

- **Where**: one row under **Advanced** on `/find-friends`, next to "Import a follow
  list". It is the same kind of thing — bring people you already know from elsewhere.
- **Visibility**: rendered only when `'contacts' in navigator`. Not disabled-with-a-reason;
  a control that can never work on this device is noise, and the surrounding page was just
  reordered to remove exactly that.
- **Flow**:
  1. Tap → browser's own picker → user selects whoever they want.
  2. For each selected contact, run the name through
     `/api/v1/accounts/search?q=<name>&limit=5`, which is what this app already calls.
  3. Show results grouped per contact, with a Follow button, and say plainly that these
     are name guesses.
  4. Show contacts with no plausible match too, with an "invite" link into the existing
     `/invites` page — that is the honest outcome for most of them.

### What it must not do

- **Never send a contact anywhere.** All matching is the existing public search endpoint,
  one query per selected contact. Nothing is stored, not even in `localStorage` — there is
  no cache to build, and a cached address book is the thing this design exists to avoid.
  Nothing goes in `storage-registry.ts` because nothing is written.
- **Never auto-follow.** Every follow is a tap, per account. A batch "follow all matches"
  over fuzzy name matching follows strangers.
- **Never claim a match it cannot support.** Copy says "accounts with similar names", not
  "your contacts on Mastodon".

### Cost

One request per selected contact, against the search server. Pick 20 contacts and that is
20 requests — real money on the proxy tier and worth capping. Suggest a hard cap of 10
selected contacts per run, with the count stated before the requests go out, matching how
the Twitter connector prices its own work.

## Testing

- Unit: support detection, the per-contact query construction, the cap, and that the
  results view renders a no-match contact as an invite rather than hiding it.
- The picker itself cannot be tested in jsdom — `navigator.contacts` does not exist there.
  Stub the manager and test everything downstream of it.
- Real-device check on Chrome/Android is the only way to confirm the picker; note that
  `.claude/skills/verify` drives desktop and cannot.

## Recommendation (superseded — see Status)

The original recommendation was **defer**, on the grounds that the addressable users are
Chrome-on-Android only and the match quality is poor for names that are not distinctive.

That reasoning was wrong in one specific way, and it is worth naming so the mistake is not
repeated: it judged the feature by its *worst* case rather than by what the worst case
costs. A wrong match here is shown with its evidence, ranked `weak`, and acted on only if
the reader clicks Follow — so a bad guess costs a glance. Meanwhile the good case (a
distinctive name, or a fediverse handle saved in the contact) is genuinely a person found.
A feature that helps sometimes and wastes a glance otherwise is worth shipping; the bar
"works for every contact" was never the right one, and this repo's four other correlation
sources all clear the real bar the same way.

What *does* stand from the research: the version that works well for common names requires
a server that ingests address books, and this project should not run one. The shipped
feature is name-only and client-only, and must stay that way.

Revisit the server question only if a privacy-preserving discovery mechanism appears in the
fediverse itself. Matrix has one worth reading if so.

## Sources

- [Contact Picker API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API)
- [ContactsManager — MDN](https://developer.mozilla.org/en-US/docs/Web/API/ContactsManager)
- [A contact picker for the web — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/contact-picker)
- [Mastodon accounts API methods](https://docs.joinmastodon.org/methods/accounts/)
- [Mastodon admin/accounts API methods](https://docs.joinmastodon.org/methods/admin/accounts/)
- [mastodon/mastodon#4186 — Find user by email, phone number etc](https://github.com/mastodon/mastodon/issues/4186)
- [Mastodon: User Discovery and Verification via Email — Cloud Security Alliance](https://cloudsecurityalliance.org/blog/2022/11/15/mastodon-user-discovery-and-verification-via-email-the-easy-way)
