import { isTestBuild } from '../../build-flavor';
import { appCallbackUrl } from '../../pkce';

/**
 * Diagnostic logging for the sign-in and checkout-return flow.
 *
 * On by default on the test deployment, and switchable anywhere else with
 * `localStorage.setItem('mawkingbird_debug_auth', '1')` — the failures this
 * exists for only reproduce on a real deployment with real cookies and a real
 * round trip through Stripe, so it has to be enable-able in production without
 * a rebuild.
 *
 * Never logs a token or a session id. The interesting facts are all *shapes*:
 * whether a mint succeeded, which tier came back, which branch was taken. A log
 * line carrying the credential would be a worse bug than the one being chased —
 * and unlike the WorkOS-era version of this file, there is no cookie to inspect
 * here at all, because the session cookie is HttpOnly and belongs to a
 * different origin.
 */
export function authDebugEnabled(): boolean {
  try {
    if (localStorage.getItem('mawkingbird_debug_auth') === '1') {
      return true;
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Fall through.
  }
  return isTestBuild();
}

/** Log a step in the auth flow, with no credential material in it. */
export function authDebug(step: string, detail: Record<string, unknown> = {}): void {
  if (!authDebugEnabled()) {
    return;
  }
  console.info(`[mawkingbird auth] ${step}`, {
    ...detail,
    path: location.pathname,
    query: [...new URLSearchParams(location.search).keys()].join(','),
  });
}

/**
 * The account page's absolute URL.
 *
 * Resolved against `document.baseURI` rather than `location.origin`, and that
 * distinction still matters after the move off WorkOS: production is
 * `mawkingbird.com/` and canary is `mawkingbird.com/canary/` — the *same
 * origin*, differing only in base href. A URL built from the origin would drop
 * `/canary/` and send a canary tester back into production after checkout.
 */
export function accountPageUrl(): string {
  return appCallbackUrl('settings/mawkingbird-plus');
}
