# UX Sprint — Finding people from phone contacts

Status: **RESEARCH DONE, NOT APPROVED TO BUILD** (written 2026-08-23)

Raised as part of the first-five-minutes batch:

> "Some way to integrate with phone contacts from website?"

Researched rather than built, on request. This document exists so whoever picks it up does
not have to rediscover why the obvious version does not work.

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

## Recommendation

**Defer.** The addressable users are Chrome-on-Android only, the match quality is poor for
reasons no amount of code fixes, and the version that works well requires a server this
project should not run. The same effort spent on starter kits and interest search — both
of which just shipped — reaches every user on every browser.

Revisit only if a privacy-preserving discovery mechanism appears in the fediverse itself.
Matrix has one worth reading if so.

## Sources

- [Contact Picker API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API)
- [ContactsManager — MDN](https://developer.mozilla.org/en-US/docs/Web/API/ContactsManager)
- [A contact picker for the web — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/contact-picker)
- [Mastodon accounts API methods](https://docs.joinmastodon.org/methods/accounts/)
- [Mastodon admin/accounts API methods](https://docs.joinmastodon.org/methods/admin/accounts/)
- [mastodon/mastodon#4186 — Find user by email, phone number etc](https://github.com/mastodon/mastodon/issues/4186)
- [Mastodon: User Discovery and Verification via Email — Cloud Security Alliance](https://cloudsecurityalliance.org/blog/2022/11/15/mastodon-user-discovery-and-verification-via-email-the-easy-way)
