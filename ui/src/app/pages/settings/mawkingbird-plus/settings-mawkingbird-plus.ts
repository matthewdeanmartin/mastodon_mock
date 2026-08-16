import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PlusSession } from '../../../providers/account/plus-session';
import { authDebug } from '../../../providers/account/auth-debug';
import { MawkingbirdSession } from '../../../providers/account/mawkingbird-session';

/**
 * Settings → Mawkingbird Plus.
 *
 * Sign in with an email address, see who you are, sign out.
 *
 * The account is deliberately free and deliberately optional. Nothing in the
 * app requires one — the CORS proxy stays anonymous, feeds keep working signed
 * out — so this page has to be honest that there is currently little to gain by
 * signing in. Overselling it now would make the later, real pitch untrustworthy.
 *
 * ## No OAuth redirect to complete
 *
 * This page used to be the WorkOS redirect target and completed a code exchange
 * on load. It no longer does: signing in means receiving a link, and the link
 * lands on the account service, which sets a cookie and redirects back here
 * already signed in. There is nothing to unpack from the URL.
 */
@Component({
  selector: 'app-settings-mawkingbird-plus',
  imports: [DatePipe],
  templateUrl: './settings-mawkingbird-plus.html',
  styleUrl: './settings-mawkingbird-plus.css',
})
export class SettingsMawkingbirdPlus implements OnInit {
  protected session = inject(MawkingbirdSession);
  protected plus = inject(PlusSession);

  /** What the user typed into the email field. */
  protected readonly email = signal('');

  /**
   * True once a link has been sent.
   *
   * Drives the "check your inbox" message. Note what it deliberately does
   * *not* mean: that an account exists. The service answers identically for a
   * known and an unknown address, so the UI must never imply the address was
   * recognised — that would reintroduce the enumeration oracle the endpoint
   * goes out of its way to avoid.
   */
  protected readonly linkSent = signal(false);

  /**
   * Set when this page was reached by returning from Stripe.
   *
   * Read once in `ngOnInit` rather than from a router signal, because the value
   * is a one-shot fact about how the page was entered — leaving it in the URL
   * would make a refresh re-congratulate the user.
   */
  protected readonly checkoutOutcome = signal<'success' | 'cancel' | null>(null);

  async ngOnInit(): Promise<void> {
    const returningFromCheckout = new URLSearchParams(location.search).has('checkout');
    authDebug('page:init', { returningFromCheckout });

    await this.session.ensureReady();

    authDebug('page:after-ensureReady', {
      returningFromCheckout,
      signedIn: this.session.user() !== null,
      error: this.session.error(),
    });

    const outcome = new URLSearchParams(location.search).get('checkout');
    if (outcome === 'success' || outcome === 'cancel') {
      this.checkoutOutcome.set(outcome);
      // Strip the parameter so a reload does not repeat the message.
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

  protected async sendLink(): Promise<void> {
    const address = this.email().trim();
    if (!address) {
      return;
    }
    const accepted = await this.session.requestSignInLink(address);
    // Only on acceptance, so a rate-limit or network failure shows the error
    // rather than a "check your inbox" for mail that was never sent.
    this.linkSent.set(accepted);
  }

  protected async signOut(): Promise<void> {
    this.plus.clear();
    await this.session.signOut();
    this.linkSent.set(false);
    this.email.set('');
  }
}
