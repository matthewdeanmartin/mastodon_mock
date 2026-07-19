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
 * hash. The one local Anonymous account uses a fixed `_anonymous` suffix. With
 * neither account mode active there is no suffix.
 */
export function accountScopeSuffix(): string {
  try {
    if (localStorage.getItem(ACCOUNT_MODE_KEY) === 'anonymous') {
      return '_anonymous';
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
  return `_${hash(token)}`;
}

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
