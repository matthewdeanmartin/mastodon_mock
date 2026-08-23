import { Component, computed, inject, Injector, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PlusSession } from '../../../providers/account/plus-session';
import { authDebug } from '../../../providers/account/auth-debug';
import { MawkingbirdSession } from '../../../providers/account/mawkingbird-session';
import { SettingsSyncToggle } from '../../../providers/account/settings-sync-toggle';
import { PlusDiagnostics } from '../../../providers/account/plus-diagnostics';
import { ProfileSync } from '../../../providers/account/profile-sync';
import { PageDiagnostics } from '../../../page-diagnostics';
import { CorsProxyUsageStore } from '../../../providers/cors-proxy/cors-proxy-usage';
import { formatBytes } from '../../../observability/local-storage-inspector';
import { PlusFeatures } from '../../../providers/account/plus-features';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import type { PlusFeature } from '../../../providers/account/plus-features';
import { PlusWelcomeDialog } from './plus-welcome-dialog/plus-welcome-dialog';
import { AdoptionDialog } from './adoption-dialog/adoption-dialog';
import { CollectionAdoptionRunner } from '../../../providers/account/collection-adoption-runner';
import type { AdoptableCollection } from '../../../providers/account/collection-adoption-runner';
import type { AdoptionChoice } from '../../../providers/account/collection-adoption';
import { VaultService } from '../../../providers/vault/vault-service';
import { VaultPreference } from '../../../providers/vault/vault-preference';
import { VaultAdoption } from '../../../providers/vault/vault-adoption';
import { FeatureFlags } from '../../../feature-flags';
import { PLUS_PRICE_USD_PER_YEAR, visiblePlusBenefits } from '../../../plus-benefits';
import { ArticleQuota, FREE_DAILY_ARTICLES } from '../../../providers/article/article-quota';

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
  imports: [DatePipe, DecimalPipe, NgTemplateOutlet, RouterLink, PlusWelcomeDialog, AdoptionDialog],
  templateUrl: './settings-mawkingbird-plus.html',
  styleUrl: './settings-mawkingbird-plus.css',
})
export class SettingsMawkingbirdPlus implements OnInit {
  protected session = inject(MawkingbirdSession);
  protected plus = inject(PlusSession);
  private proxy = inject(CorsProxySettings);
  protected features = inject(PlusFeatures);
  /** Settings sync, as one on/off over `ProfileSync`'s five states. */
  protected settingsSync = inject(SettingsSyncToggle);
  protected diagnostics = inject(PlusDiagnostics);
  private sync = inject(ProfileSync);
  private proxyUsageStore = inject(CorsProxyUsageStore);
  protected articleQuota = inject(ArticleQuota);
  private log = inject(PageDiagnostics);
  private injector = inject(Injector);
  protected vault = inject(VaultService);
  protected vaultPreference = inject(VaultPreference);

  /** Proxy counters, local and account-wide. */
  private flags = inject(FeatureFlags);

  /**
   * What the subscription buys, from `plus-benefits.ts` rather than from prose.
   *
   * Filtered by flag so the page never advertises a capability this build has
   * switched off — the previous hand-written copy could not do that, and said
   * the proxy tier existed whether or not the proxy flag was on.
   */
  protected readonly benefits = computed(() =>
    visiblePlusBenefits((flag) => this.flags.enabled(flag)),
  );
  protected readonly priceUsd = PLUS_PRICE_USD_PER_YEAR;
  protected readonly freeDailyArticles = FREE_DAILY_ARTICLES;

  protected readonly proxyUsage = this.proxyUsageStore.usage;
  protected readonly formatBytes = formatBytes;
  protected readonly syncing = signal(false);
  protected readonly syncMessage = signal<string | null>(null);
  protected readonly vaultBusy = signal(false);
  protected readonly vaultMessage = signal<string | null>(null);
  protected readonly vaultPassphrase = signal('');
  protected readonly vaultPassphraseAgain = signal('');
  protected readonly vaultNextPassphrase = signal('');
  protected readonly vaultDeleteArmed = signal(false);
  private adoption = inject(CollectionAdoptionRunner);

  protected readonly vaultConnectors = computed(() =>
    this.vault.storedConnectors().map((id) => VAULT_CONNECTOR_LABELS[id] ?? id),
  );

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

  /** Collections left to inspect after the current merge-or-replace question. */
  private adoptionQueue: AdoptableCollection[] = [];

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
  /**
   * The toggle list, with settings sync spliced in as a live row.
   *
   * Settings sync is **not** a stored preference — it is a view of
   * `ProfileSync`, which is the only thing that decides whether anything
   * uploads. It used to be both, and the two disagreed: a stored
   * `settingsSync: true` showed the toggle on while sync sat at `unasked`,
   * so this page said "enabled" while the Config page correctly said "off".
   *
   * Rendered first because it is the one people look for, and because the rest
   * of the list is about *what* syncs while this one is about *whether*.
   */
  protected readonly featureRows = computed<FeatureRow[]>(() => [
    {
      feature: 'settingsSync' as const,
      on: this.settingsSync.on(),
      label: 'Settings sync',
    },
    ...this.features
      .all()
      .filter((row) => row.feature !== 'apiKeys')
      .map((row) => ({ ...row, label: FEATURE_LABELS[row.feature] })),
  ]);

  protected async setFeature(feature: ToggleId, on: boolean): Promise<void> {
    this.adoptionError.set('');

    if (feature === 'settingsSync') {
      // Straight through to ProfileSync. Nothing is stored here, so there is no
      // second copy of this answer to fall out of step.
      //
      // Logged on both sides of the call: this toggle decides whether anything
      // syncs at all, and "I clicked it and nothing happened" needs to be
      // answerable from a console paste.
      const before = this.settingsSync.detail();
      this.log.info('PlusPage', 'settings-sync:set', { on, before });
      const failure = await this.settingsSync.set(on);
      this.log.info('PlusPage', 'settings-sync:done', {
        on,
        before,
        after: this.settingsSync.detail(),
        syncing: this.settingsSync.on(),
        failure,
      });
      // Shown, not just logged. Turning sync on can be refused by the service,
      // and a toggle that quietly returns to off tells the user nothing about
      // why — which is exactly how a stale-token 402 stayed invisible.
      if (failure) {
        this.adoptionError.set(failure);
      }
      return;
    }

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
      this.adoptionQueue = [];
      return;
    }
    await this.continueCollectionReconciliation();
  }

  /** Backed out of the question: the toggle goes back off, nothing is touched. */
  protected async cancelAdoption(): Promise<void> {
    const pending = this.pendingAdoption();
    if (pending) {
      this.features.set(FEATURE_FOR[pending.collection], false);
    }
    this.pendingAdoption.set(null);
    await this.continueCollectionReconciliation();
  }

  /**
   * The welcome dialog records the choices; this performs their network side.
   *
   * Without this hand-off, the default-on collection switches were persisted
   * as though they were active but their first adoption never ran. Since the
   * switches were already on, there was no later off-to-on transition to run it.
   */
  protected async welcomeSaved(): Promise<void> {
    this.features.refresh();
    this.adoptionError.set('');
    if (
      this.vaultPreference.available &&
      this.plus.isSupporter() &&
      this.vaultPreference.enabled()
    ) {
      await this.refreshVault();
    }
    const result = await this.reconcileCollections(this.enabledCollections(), true);
    if (result.errors.length > 0) {
      this.adoptionError.set(result.errors.join(' '));
    }
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
      if (
        this.vaultPreference.available &&
        this.plus.isSupporter() &&
        this.vaultPreference.enabled()
      ) {
        await this.refreshVault();
        if (this.vault.unlocked()) {
          await this.syncExistingVaultKeys();
        }
      }
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
    void this.vault.lock();
    this.plus.clear();
    await this.session.signOut();
    // `signOut()` clears the stored record; this re-reads it, so the next
    // account gets the dialog rather than inheriting this one's answer.
    this.features.refresh();
    this.linkSent.set(false);
    this.email.set('');
  }

  /** Turn connection-key sync on for this account in test, or stop it locally. */
  protected async setVaultEnabled(on: boolean): Promise<void> {
    if (!this.vaultPreference.available || (on && !this.plus.isSupporter())) {
      return;
    }
    this.vaultPreference.set(on);
    this.vaultMessage.set(null);
    this.vaultDeleteArmed.set(false);
    if (!on) {
      await this.vault.lock();
      this.vaultMessage.set(
        'Connection-key sync is off on this browser. The encrypted stored copy was not deleted.',
      );
      return;
    }
    await this.refreshVault();
    if (this.vault.unlocked()) {
      await this.syncExistingVaultKeys();
    }
  }

  /** Re-check the remote state; this is also the diagnostics retry button. */
  protected async refreshVault(): Promise<void> {
    if (!this.vaultPreference.available || !this.vaultPreference.enabled()) {
      return;
    }
    this.vaultBusy.set(true);
    this.vaultMessage.set(null);
    try {
      await this.vault.refresh();
    } finally {
      this.vaultBusy.set(false);
    }
  }

  /** Create the encrypted store, then import eligible keys already in this browser. */
  protected async createVault(): Promise<void> {
    if (this.vaultPassphrase() !== this.vaultPassphraseAgain()) {
      this.vaultMessage.set('The two passphrases do not match.');
      return;
    }
    this.vaultBusy.set(true);
    this.vaultMessage.set(null);
    try {
      const problem = await this.vault.create(this.vaultPassphrase());
      if (problem) {
        this.vaultMessage.set(problem);
        return;
      }
      this.vaultPassphrase.set('');
      this.vaultPassphraseAgain.set('');
      await this.syncExistingVaultKeys();
    } finally {
      this.vaultBusy.set(false);
    }
  }

  protected async unlockVault(): Promise<void> {
    this.vaultBusy.set(true);
    this.vaultMessage.set(null);
    try {
      const opened = await this.vault.unlock(this.vaultPassphrase());
      if (opened) {
        this.vaultPassphrase.set('');
        await this.syncExistingVaultKeys();
      } else {
        this.vaultMessage.set(this.vault.notice() ?? 'That passphrase did not open the vault.');
      }
    } finally {
      this.vaultBusy.set(false);
    }
  }

  protected async lockVault(): Promise<void> {
    await this.vault.lock();
    this.vaultMessage.set('Locked on this browser. The encrypted copy remains stored.');
  }

  /** Reconcile low-churn credentials in both directions, with empty losing to present. */
  protected async syncExistingVaultKeys(): Promise<void> {
    if (!this.vault.unlocked() || !this.vaultPreference.enabled()) {
      this.vaultMessage.set('Unlock stored connections before syncing keys from this browser.');
      return;
    }
    this.vaultBusy.set(true);
    try {
      const result = await this.injector.get(VaultAdoption).reconcileExisting();
      const messages: string[] = [`Opened ${this.vault.count()} stored connection credential(s).`];
      if (result.restored.length > 0) {
        messages.push(`Restored to this browser: ${result.restored.join(', ')}.`);
      }
      if (result.stored.length > 0) {
        messages.push(`Stored from this browser: ${result.stored.join(', ')}.`);
      }
      if (result.merged.length > 0) {
        messages.push(`Safely merged missing data for: ${result.merged.join(', ')}.`);
      }
      if (result.conflicts.length > 0) {
        messages.push(
          `Left conflicting non-empty copies unchanged for ${result.conflicts
            .map((failure) => failure.connector)
            .join(', ')}.`,
        );
      }
      if (result.failed.length > 0) {
        messages.push(
          `Could not store ${result.failed.map((failure) => failure.connector).join(', ')}: ${result.failed
            .map((failure) => failure.message)
            .join(' ')}`,
        );
      }
      if (
        result.restored.length === 0 &&
        result.stored.length === 0 &&
        result.merged.length === 0 &&
        result.conflicts.length === 0 &&
        result.failed.length === 0
      ) {
        messages.push('This browser and the encrypted copy are already reconciled.');
      }
      this.vaultMessage.set(messages.join(' '));
    } finally {
      this.vaultBusy.set(false);
    }
  }

  protected async changeVaultPassphrase(): Promise<void> {
    this.vaultBusy.set(true);
    this.vaultMessage.set(null);
    try {
      const problem = await this.vault.changePassphrase(this.vaultNextPassphrase());
      this.vaultMessage.set(problem ?? 'Passphrase changed on this encrypted store.');
      if (!problem) {
        this.vaultNextPassphrase.set('');
      }
    } finally {
      this.vaultBusy.set(false);
    }
  }

  protected async setVaultPolicy(value: string): Promise<void> {
    const policy = VAULT_POLICIES[value];
    if (!policy) {
      return;
    }
    this.vaultBusy.set(true);
    try {
      const result = await this.vault.setPolicy(policy);
      this.vaultMessage.set(result ? 'Stored-copy retention updated.' : this.vault.notice());
    } finally {
      this.vaultBusy.set(false);
    }
  }

  protected vaultPolicyValue(): string {
    const policy = this.vault.meta()?.policy;
    if (!policy) {
      return 'idle-90';
    }
    return policy.kind === 'never' ? 'never' : `${policy.kind}-${policy.days}`;
  }

  protected async destroyVault(): Promise<void> {
    if (!this.vaultDeleteArmed()) {
      this.vaultDeleteArmed.set(true);
      return;
    }
    this.vaultBusy.set(true);
    try {
      const destroyed = await this.vault.destroy();
      this.vaultMessage.set(
        destroyed
          ? 'The encrypted stored copy was deleted. Connector keys in this browser were not changed.'
          : this.vault.notice(),
      );
      this.vaultDeleteArmed.set(false);
    } finally {
      this.vaultBusy.set(false);
    }
  }

  /** Read local and remote state. Changes nothing — see `plus-diagnostics.ts`. */
  protected async loadDiagnostics(): Promise<void> {
    this.syncMessage.set(null);
    await this.diagnostics.load();
  }

  /**
   * Why the sync button is unavailable, or null when it is fine.
   *
   * Shown next to the button rather than left for the click to reveal. "Sync
   * now" that reports "settings sync is off" only after being pressed is a
   * button that looks broken — the reason was knowable before the press.
   */
  protected syncBlockedReason(): string | null {
    if (!this.settingsSync.on() && this.enabledCollections().length === 0) {
      return 'All sync features are off. Turn on at least one above and this will start working.';
    }
    if (this.sync.readOnly()) {
      // Not "your subscription has lapsed": this state is reached by anyone
      // without an active subscription, which includes everyone who never had
      // one. Telling them something of theirs ran out is an accusation about an
      // event that did not happen.
      return 'Settings are not being saved to your account, because storing them there is part of Mawkingbird Plus.';
    }
    return null;
  }

  /**
   * Push this browser's settings and enabled collections, then re-read.
   *
   * Interactive, so a failure is reported now rather than counted towards a
   * later warning — the user is watching a button they just pressed.
   */
  protected async syncNow(): Promise<void> {
    this.syncing.set(true);
    this.syncMessage.set(null);
    this.log.info('PlusPage', 'sync-now:start', {
      syncState: this.sync.record().state,
      syncing: this.sync.syncing(),
      dirty: this.sync.record().dirty === true,
    });
    try {
      const outcome = await this.sync.push(true);
      this.log.info('PlusPage', 'sync-now:outcome', { kind: outcome.kind });
      const messages: string[] = [];
      switch (outcome.kind) {
        case 'saved':
          messages.push(`Uploaded ${outcome.keys} setting(s) as revision ${outcome.revision}.`);
          break;
        case 'not-syncing':
          messages.push('Settings sync is off. Turn it on above first.');
          break;
        case 'conflict':
          messages.push('Your account changed first. Check again to see what it holds.');
          break;
        default:
          messages.push(outcome.message);
      }

      const collections = await this.reconcileCollections(this.enabledCollections(), false);
      if (collections.synced.length > 0) {
        messages.push(
          `Synced ${collections.synced.map((collection) => COLLECTION_LABELS[collection]).join(', ')}.`,
        );
      }
      if (collections.pending) {
        messages.push(`Choose how to reconcile ${COLLECTION_LABELS[collections.pending]}.`);
      }
      if (collections.errors.length > 0) {
        messages.push(collections.errors.join(' '));
      }
      this.syncMessage.set(messages.join(' '));
      await this.diagnostics.load();
    } finally {
      this.syncing.set(false);
    }
  }

  /** Collections whose saved Plus choices say they belong on the account. */
  private enabledCollections(): AdoptableCollection[] {
    return (Object.keys(FEATURE_FOR) as AdoptableCollection[]).filter((collection) =>
      this.features.isOn(FEATURE_FOR[collection]),
    );
  }

  /**
   * Settle each enabled collection until one needs a user decision.
   *
   * The remaining work is queued because only one adoption dialog can be on
   * screen at a time. Resolving or cancelling that dialog resumes the queue.
   */
  private async reconcileCollections(
    collections: AdoptableCollection[],
    disableOnFailure: boolean,
  ): Promise<CollectionReconciliation> {
    this.adoptionQueue = [];
    const synced: AdoptableCollection[] = [];
    const errors: string[] = [];

    for (const [index, collection] of collections.entries()) {
      const inspection = await this.adoption.inspect(collection);
      if (inspection.error) {
        if (disableOnFailure) {
          this.features.set(FEATURE_FOR[collection], false);
        }
        errors.push(`${COLLECTION_LABELS[collection]}: ${inspection.error}`);
        continue;
      }
      if (inspection.needsChoice) {
        this.adoptionQueue = collections.slice(index + 1);
        this.pendingAdoption.set({
          collection: inspection.collection,
          localCount: inspection.localCount,
          remoteCount: inspection.remoteCount,
        });
        return { synced, errors, pending: collection };
      }
      synced.push(collection);
    }

    return { synced, errors, pending: null };
  }

  /** Continue work that was paused behind an adoption dialog. */
  private async continueCollectionReconciliation(): Promise<void> {
    const remaining = this.adoptionQueue;
    this.adoptionQueue = [];
    if (remaining.length === 0) {
      return;
    }
    const result = await this.reconcileCollections(remaining, true);
    if (result.errors.length > 0) {
      this.adoptionError.set(result.errors.join(' '));
    }
  }
}

/**
 * What a toggle can govern.
 *
 * `settingsSync` is not a {@link PlusFeature} — it has no stored preference and
 * lives entirely in `ProfileSync`. It is a toggle on this page and nothing else,
 * which is exactly what this type says.
 */
type ToggleId = PlusFeature | 'settingsSync';

interface FeatureRow {
  feature: ToggleId;
  on: boolean;
  label: string;
}

interface CollectionReconciliation {
  synced: AdoptableCollection[];
  errors: string[];
  pending: AdoptableCollection | null;
}

const FEATURE_LABELS: Record<PlusFeature, string> = {
  corsProxy: 'Mawkingbird CORS proxy',
  trustSync: 'Trusted accounts',
  listsSync: 'Client lists',
  feedsSync: 'RSS subscription list',
  apiKeys: 'Encrypted connection keys',
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

const COLLECTION_LABELS: Record<AdoptableCollection, string> = {
  trust: 'trusted accounts',
  feeds: 'RSS subscriptions',
  lists: 'client lists',
};

const VAULT_CONNECTOR_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  'cors-proxy': 'CORS proxy',
  'link-shortener': 'Link shorteners',
  raindrop: 'Raindrop',
  twitter: 'Twitter',
  mataroa: 'Mataroa',
  hugo: 'Hugo',
  github: 'GitHub',
  gist: 'GitHub Gist',
};

const VAULT_POLICIES: Record<
  string,
  import('../../../providers/vault/vault-client').VaultMeta['policy']
> = {
  'idle-90': { kind: 'idle', days: 90 },
  'idle-365': { kind: 'idle', days: 365 },
  'absolute-90': { kind: 'absolute', days: 90 },
  'absolute-365': { kind: 'absolute', days: 365 },
  never: { kind: 'never' },
};
