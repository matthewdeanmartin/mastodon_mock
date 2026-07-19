const TOKEN_KEY = 'mastodon_mock_token';

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
 * The active token is the only account identifier guaranteed present in
 * localStorage at service-construction time, so the scope derives from it — but
 * a raw bearer token must never appear in a storage key, so we fold it into a
 * short non-reversible hash. No token, no suffix (a logged-out shell shares one
 * anonymous namespace, which is fine — there's no account to attribute to).
 */
export function accountScopeSuffix(): string {
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
