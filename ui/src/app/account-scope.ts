import { blueskyIdentityDid } from './providers/bluesky/bluesky-identity-store';

const TOKEN_KEY = 'mastodon_mock_token';
const ACCOUNT_MODE_KEY = 'mastodon_mock_account_mode';

/**
 * A short, stable, non-secret suffix identifying the currently-active account,
 * for namespacing client-side (localStorage) settings *per account*.
 *
 * Settings like RSS subscriptions and the linked Bluesky account belong to the
 * account that set them up — seeing another account's feeds is confusing and
 * wrong. Since these are client-only (they must work against any instance, so
 * nothing is stored server-side), we scope their storage keys by the active
 * account here.
 *
 * Authenticated scopes derive from the active token — but a raw bearer token
 * must never appear in a storage key, so we fold it into a short non-reversible
 * hash. The one local Anonymous account uses a fixed `_anonymous` suffix. A
 * Bluesky-primary account uses `_bsky_` plus a hash of its DID. With no account
 * mode active there is no suffix.
 *
 * ## Do not "tidy" the existing branches
 *
 * The `_anonymous` and `_<hash(token)>` suffixes are load-bearing: every scoped
 * key in the app is derived from them, so changing one by a single character
 * silently repoints a user's RSS feeds, saved searches, lists and linked
 * accounts at a namespace that has never been written. There is no migration
 * and no error — the data simply appears to be gone. `account-scope.spec.ts`
 * pins both against hardcoded literals for exactly this reason.
 */
export function accountScopeSuffix(): string {
  try {
    const mode = localStorage.getItem(ACCOUNT_MODE_KEY);
    if (mode === 'anonymous') {
      return '_anonymous';
    }
    if (mode === 'bluesky') {
      const did = blueskyIdentityDid();
      // A `bluesky` mode with no identity behind it is a stale key, not an
      // account. Falling through to the logged-out namespace matches what Auth
      // does with the same inconsistency, so the two cannot disagree about
      // which account is active.
      return did ? scopeSuffixForDid(did) : '';
    }
  } catch {
    // Fall through to the logged-out namespace when storage is unavailable.
  }
  let token: string | null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  if (!token) {
    return '';
  }
  return scopeSuffixForToken(token);
}

/**
 * The suffix a *given* token's data is stored under, without making that token
 * active. Needed to find (and delete) the local data of an account other than
 * the one currently signed in — see the Signed-in accounts settings page.
 */
export function scopeSuffixForToken(token: string): string {
  return token ? `_${hash(token)}` : '';
}

/**
 * The suffix a *given* Bluesky-primary account's data is stored under, without
 * making it active. The sibling of {@link scopeSuffixForToken}, and needed for
 * the same reason: to find (and delete) the local data of an account other than
 * the one currently signed in.
 *
 * The DID is hashed for consistency with the token branch and to keep the
 * suffix short — not for secrecy. A DID is public, and unlike a bearer token
 * there would be no harm in it appearing here.
 */
export function scopeSuffixForDid(did: string): string {
  return did ? `${BLUESKY_SCOPE_PREFIX}${hash(did)}` : '';
}

/** The suffix the one browser-local Anonymous account stores its data under. */
export const ANONYMOUS_SCOPE_SUFFIX = '_anonymous';

/**
 * What every Bluesky-primary scope suffix starts with.
 *
 * Exported so callers enumerating storage can tell a Bluesky-primary namespace
 * apart from a Mastodon one, which is otherwise impossible: both are `_` plus
 * an opaque hash.
 */
export const BLUESKY_SCOPE_PREFIX = '_bsky_';

/** Build a per-account storage key from a base key. */
export function scopedKey(baseKey: string): string {
  return `${baseKey}${accountScopeSuffix()}`;
}

/**
 * A tiny, fast, non-cryptographic string hash (FNV-1a, base36). Not for
 * security — only to turn a token into a compact, stable, opaque namespace tag
 * so the secret itself never lands in a storage key.
 */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range with Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
