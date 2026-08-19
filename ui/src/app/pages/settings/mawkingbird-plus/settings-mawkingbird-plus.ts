import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PlusSession } from '../../../providers/account/plus-session';
import { authDebug } from '../../../providers/account/auth-debug';
import { MawkingbirdSession } from '../../../providers/account/mawkingbird-session';
import { PlusFeatures } from '../../../providers/account/plus-features';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import type { PlusFeature } from '../../../providers/account/plus-features';
import { PlusWelcomeDialog } from './plus-welcome-dialog/plus-welcome-dialog';
import { AdoptionDialog } from './adoption-dialog/adoption-dialog';
import { CollectionAdoptionRunner } from '../../../providers/account/collection-adoption-runner';
import type { AdoptableCollection } from '../../../providers/account/collection-adoption-runner';
import type { AdoptionChoice } from '../../../providers/account/collection-adoption';

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
  imports: [DatePipe, PlusWelcomeDialog, AdoptionDialog],
  templateUrl: './settings-mawkingbird-plus.html',
  styleUrl: './settings-mawkingbird-plus.css',
})
export class SettingsMawkingbirdPlus implements OnInit {
  protected session = inject(MawkingbirdSession);
  protected plus = inject(PlusSession);
  private proxy = inject(CorsProxySettings);
  protected features = inject(PlusFeatures);
  private adoption = inject(CollectionAdoptionRunner);

  /**
   * The collection waiting on a merge-or-replace answer, if any.
   *
   * Held here rather than in the dialog so that backing out can put the toggle
   * back where it was — the dialog itself has no idea a toggle was involved.
   */
  protected readonly pendingAdoption = signal<{
    collection: AdoptableCollection;
    localCount: number;
    remoteCount: number;
  } | null>(null);

  /** A failure from the last adoption attempt, shown next to the toggles. */
  protected readonly adoptionError = signal('');

  /**
   * Whether to show the one-time welcome dialog.
   *
   * Signed in, entitled, and never answered. Entitlement is part of it because
   * the dialog is about what a *subscription* switches on — showing it to a free
   * account would be an advert wearing a dialog's clothes.
   */
  protected readonly showWelcome = computed(
    () => this.session.user() !== null && this.plus.isSupporter() && !this.features.decided(),
  );

  /** The toggles, mirrored here so a decision can always be revisited. */
  protected readonly featureRows = computed(() =>
    this.features.all().map((row) => ({ ...row, label: FEATURE_LABELS[row.feature] })),
  );

  protected async setFeature(feature: PlusFeature, on: boolean): Promise<void> {
    this.adoptionError.set('');
    this.features.set(feature, on);

    if (feature === 'corsProxy' && on && this.proxy.missingEntitledProxy()) {
      this.proxy.adoptSupporterProxy();
      return;
    }

    // Turning a collection *off* is just a setting: nothing is uploaded and
    // nothing stored is deleted, so there is nothing to reconcile.
    const collection = COLLECTION_FOR[feature];
    if (!collection || !on) {
      return;
    }

    const inspection = await this.adoption.inspect(collection);
    if (inspection.error) {
      // Put the toggle back: claiming a collection is syncing when the first
      // read failed is the lie that makes people trust a sync that is not
      // running.
      this.features.set(feature, false);
      this.adoptionError.set(inspection.error);
      return;
    }
    if (inspection.needsChoice) {
      this.pendingAdoption.set({
        collection: inspection.collection,
        localCount: inspection.localCount,
        remoteCount: inspection.remoteCount,
      });
    }
  }

  protected async resolveAdoption(choice: AdoptionChoice): Promise<void> {
    const pending = this.pendingAdoption();
    if (!pending) {
      return;
    }
    const ok = await this.adoption.apply(pending.collection, choice);
    this.pendingAdoption.set(null);
    if (!ok) {
      this.features.set(FEATURE_FOR[pending.collection], false);
      this.adoptionError.set('That could not be saved to your account. Nothing was changed.');
    }
  }

  /** Backed out of the question: the toggle goes back off, nothing is touched. */
  protected cancelAdoption(): void {
    const pending = this.pendingAdoption();
    if (pending) {
      this.features.set(FEATURE_FOR[pending.collection], false);
    }
    this.pendingAdoption.set(null);
  }

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
    // `signOut()` clears the stored record; this re-reads it, so the next
    // account gets the dialog rather than inheriting this one's answer.
    this.features.refresh();
    this.linkSent.set(false);
    this.email.set('');
  }
}

const FEATURE_LABELS: Record<PlusFeature, string> = {
  corsProxy: 'Mawkingbird CORS proxy',
  settingsSync: 'Settings sync',
  trustSync: 'Trusted accounts',
  listsSync: 'Client lists',
  feedsSync: 'RSS subscription list',
};

/** Which collection a toggle governs. Toggles with no collection sync nothing. */
const COLLECTION_FOR: Partial<Record<PlusFeature, AdoptableCollection>> = {
  trustSync: 'trust',
  feedsSync: 'feeds',
  listsSync: 'lists',
};

const FEATURE_FOR: Record<AdoptableCollection, PlusFeature> = {
  trust: 'trustSync',
  feeds: 'feedsSync',
  lists: 'listsSync',
};
