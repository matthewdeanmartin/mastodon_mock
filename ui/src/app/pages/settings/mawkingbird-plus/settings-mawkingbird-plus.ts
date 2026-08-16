import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PlusSession } from '../../../providers/workos/plus-session';
import { authDebug, displayName, WorkosSession } from '../../../providers/workos/workos-session';

/**
 * Settings → Mawkingbird Plus.
 *
 * Today this page does one thing: sign in, show who you are, sign out. It is
 * named for what it will become rather than what it currently is, because the
 * account exists to hang paid features off later and renaming a settings tab
 * costs users their bearings.
 *
 * The account is deliberately free and deliberately optional. Nothing in the
 * app requires one — the CORS proxy stays anonymous, feeds keep working signed
 * out — so this page has to be honest that there is currently nothing to gain
 * by signing in. Overselling it now would be the kind of thing that makes the
 * later, real pitch untrustworthy.
 *
 * The redirect lands back *here*, and the SDK completes the exchange during
 * {@link WorkosSession.ensureReady} — see the class doc there for why there is
 * no callback route.
 */
@Component({
  selector: 'app-settings-mawkingbird-plus',
  imports: [DatePipe],
  templateUrl: './settings-mawkingbird-plus.html',
  styleUrl: './settings-mawkingbird-plus.css',
})
export class SettingsMawkingbirdPlus implements OnInit {
  protected session = inject(WorkosSession);
  protected plus = inject(PlusSession);

  /** The signed-in user's name, or null when they never supplied one. */
  protected readonly name = computed(() => {
    const user = this.session.user();
    return user ? displayName(user) : null;
  });

  /**
   * Set when this page was reached by returning from Stripe.
   *
   * Read once in `ngOnInit` rather than from a router signal, because the
   * value is a one-shot fact about how the page was entered — leaving it in
   * the URL would make a refresh re-congratulate the user.
   */
  protected readonly checkoutOutcome = signal<'success' | 'cancel' | null>(null);

  async ngOnInit(): Promise<void> {
    const returningFromCheckout = new URLSearchParams(location.search).has('checkout');
    authDebug('page:init', { returningFromCheckout });

    // Also completes a pending sign-in redirect, since this page is the WorkOS
    // redirect target. Awaited here — unlike before — because everything below
    // needs to know whether anyone is signed in.
    await this.session.ensureReady();

    // The exact symptom being chased: signed out immediately after paying, then
    // signed in again on a manual retry. If `signedIn` is false here while the
    // session cookie is present, the SDK had something to restore from and did
    // not; if the cookie is absent, the browser dropped it on the way back from
    // Stripe and no amount of app code will recover it.
    authDebug('page:after-ensureReady', {
      returningFromCheckout,
      signedIn: this.session.user() !== null,
      error: this.session.error(),
    });

    const outcome = new URLSearchParams(location.search).get('checkout');
    if (outcome === 'success' || outcome === 'cancel') {
      this.checkoutOutcome.set(outcome);
      // Strip the parameter so a reload does not repeat the message. The
      // WorkOS SDK does the same for its own `code`/`state`.
      const clean = new URL(location.href);
      clean.searchParams.delete('checkout');
      history.replaceState({}, '', clean);
    }

    if (this.session.user()) {
      authDebug('page:refreshing-tier');
      // A fresh mint rather than a cached one: on a checkout return the
      // entitlement was written seconds ago, and a stale token would show the
      // old tier for up to fifteen minutes.
      await this.plus.refresh();
    }
  }

  protected async signOut(): Promise<void> {
    this.plus.clear();
    await this.session.signOut();
  }
}
