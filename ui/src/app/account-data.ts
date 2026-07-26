import { ANONYMOUS_SCOPE_SUFFIX, scopeSuffixForToken } from './account-scope';
import { formatBytes, inspectLocalStorage, StorageReport } from './observability/local-storage-inspector';

/**
 * Finding and deleting the browser-local data belonging to one saved account.
 *
 * Client-side settings (RSS feeds, the linked Bluesky session, local moderation,
 * saved searches, …) are namespaced per account by `scopedKey()`. That works
 * fine until you want to *clean up*: logged in twice to the same server, or
 * wanting to reset one account's local state without signing out of it. This
 * module is the inverse of scopedKey — given an account, which keys are its own?
 *
 * Deliberately distinct from the Local storage settings page: that one is a
 * fine-grained key-by-key inspector for the *active* account. This one operates
 * on whole accounts, including ones that are not currently signed in.
 */

/** Anonymous keys predate scoping and use a prefix instead of a suffix. */
const ANONYMOUS_PREFIX = 'mockingbird_anonymous_';

/**
 * Does `key` belong to the account identified by `suffix`?
 *
 * The empty suffix (a logged-out scope) matches nothing on purpose: it would
 * otherwise match unscoped global keys and blow away app-wide settings.
 */
export function keyBelongsToScope(key: string, suffix: string): boolean {
  if (!suffix) {
    return false;
  }
  if (suffix === ANONYMOUS_SCOPE_SUFFIX) {
    return key.startsWith(ANONYMOUS_PREFIX) || key.endsWith(suffix);
  }
  return key.endsWith(suffix);
}

/** The storage scope suffix for a saved account (token, or Anonymous). */
export function scopeForAccount(token: string | null): string {
  return token === null ? ANONYMOUS_SCOPE_SUFFIX : scopeSuffixForToken(token);
}

/** Every localStorage entry belonging to one account, with sizes. */
export function inspectAccountData(token: string | null): StorageReport {
  const suffix = scopeForAccount(token);
  return inspectLocalStorage((key) => keyBelongsToScope(key, suffix));
}

/**
 * Delete every localStorage entry belonging to one account. Returns how many
 * keys were removed, so the caller can report what actually happened.
 */
export function deleteAccountData(token: string | null): number {
  const { entries } = inspectAccountData(token);
  for (const entry of entries) {
    localStorage.removeItem(entry.key);
  }
  return entries.length;
}

export { formatBytes };
