/**
 * Storage for a **Bluesky-primary** account's own session.
 *
 * ## Why this is not just `scopedKey('mockingbird_bsky_profile')`
 *
 * A Bluesky link under a Mastodon-primary account is a *connector*: it is one of
 * several networks hanging off an identity, and it is scoped per account so a
 * link set up as one persona is not visible as another (see `account-scope.ts`).
 *
 * A Bluesky-primary account's session is not that. It **is** the identity. And
 * scoping it by the active account would be circular — the scope suffix is
 * derived from the DID, which lives inside the very thing being scoped.
 *
 * So it is stored the way the Mastodon session stable is stored: unscoped, and
 * split into a non-secret half a settings export may carry and a secret half it
 * never may. Same class, same shape, different storage strategy.
 *
 * The two halves are joined by nothing — there is at most one Bluesky-primary
 * account per browser for now, so the keys are singletons rather than a list.
 * Growing to several is a matter of turning these into keyed records, which is
 * why the reader tolerates (and discards) a half-written pair.
 */

/**
 * The active account kind. Declared here rather than imported from `auth.ts`,
 * which would pull the whole `Auth` service (and its `Server` /
 * `AnonymousAccount` dependencies) into `providers/` and close a cycle. This
 * mirrors what `account-scope.ts` does with the same key and for the same reason.
 */
export const ACCOUNT_MODE_KEY = 'mastodon_mock_account_mode';

/** Who is linked. Exportable: names an account, carries no credential. */
export const BSKY_IDENTITY_PROFILE_KEY = 'mockingbird_bsky_identity_profile';

/** The JWTs. Never exported, under any profile. */
export const BSKY_IDENTITY_CREDENTIALS_KEY = 'mockingbird_bsky_identity_credentials';

/**
 * The DID of the Bluesky-primary account, or null when there isn't one.
 *
 * Deliberately a bare function reading `localStorage` rather than a method on an
 * injectable: `account-scope.ts` needs it to build a storage suffix, and it is
 * called from constructors and module scope where no injector exists. It also
 * keeps `account-scope.ts` free of any Angular or provider import, which is what
 * stops this from becoming a dependency cycle.
 *
 * Reads only the *profile* half. The DID is not a secret, and asking for it must
 * never require touching the credentials.
 */
export function blueskyIdentityDid(): string | null {
  try {
    const raw = localStorage.getItem(BSKY_IDENTITY_PROFILE_KEY);
    if (!raw) {
      return null;
    }
    const did = (JSON.parse(raw) as { did?: unknown }).did;
    return typeof did === 'string' && did ? did : null;
  } catch {
    // Unparseable profile: treat as absent rather than throwing from a storage
    // key builder, which would break every scoped read in the app at once.
    return null;
  }
}

/**
 * Whether a usable Bluesky-primary identity is present.
 *
 * Both halves are required. A profile with no credentials cannot authenticate,
 * which is exactly the state a machine that imported settings but has not
 * re-authorized Bluesky yet is in — and `Auth` uses this to refuse to activate
 * the `bluesky` account kind, so a stale mode key cannot strand the app in an
 * identity that can't make a request.
 */
export function blueskyIdentityPresent(): boolean {
  try {
    return (
      localStorage.getItem(BSKY_IDENTITY_PROFILE_KEY) !== null &&
      localStorage.getItem(BSKY_IDENTITY_CREDENTIALS_KEY) !== null
    );
  } catch {
    return false;
  }
}

/** Forget the Bluesky-primary identity. Both halves, always together. */
export function clearBlueskyIdentity(): void {
  localStorage.removeItem(BSKY_IDENTITY_PROFILE_KEY);
  localStorage.removeItem(BSKY_IDENTITY_CREDENTIALS_KEY);
}

/**
 * Whether the active account kind is Bluesky-primary *and* backed by a real
 * identity — i.e. whether a `BlueskySession` constructed right now is the app's
 * identity rather than a connector.
 *
 * Duplicates the reasoning in `Auth.storedKind()` deliberately. `providers/` must
 * not import `Auth` (it would close a dependency cycle through
 * `account-scope.ts`), and both consult exactly the same two facts — the mode key
 * and the presence of both identity halves — so they cannot disagree about which
 * account is active. A `bluesky` mode key with no identity behind it is a stale
 * key, and is treated as absent in both places.
 */
export function blueskyIsPrimaryKind(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_MODE_KEY) === 'bluesky' && blueskyIdentityPresent();
  } catch {
    return false;
  }
}
