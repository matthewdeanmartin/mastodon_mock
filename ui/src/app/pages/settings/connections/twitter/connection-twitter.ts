import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CorsProxy } from '../../../../providers/cors-proxy/cors-proxy';
import { CorsProxyEntry } from '../../../../providers/cors-proxy/cors-proxy-catalog';
import { ProxyConsent } from '../../../../providers/proxy-consent-store';
import { TwitterConsentDialog } from '../../../../providers/twitter/twitter-consent-dialog/twitter-consent-dialog';
import {
  TwitterReachability,
  TwitterReachabilityResult,
} from '../../../../providers/twitter/twitter-reachability';
import { TwitterSettings } from '../../../../providers/twitter/twitter-settings';
import {
  availableTwitterSources,
  TwitterSourceEntry,
  TwitterSourceId,
} from '../../../../providers/twitter/twitter-source';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { expiryLabel } from '../expiry-label';

/**
 * Settings → Connections → X (Twitter).
 *
 * ## The flow this page has to walk someone through
 *
 * Connecting this is genuinely harder than any other connector here, because it
 * needs *two* third parties: the data service, and a CORS proxy to reach it.
 * Presenting that as one wall of configuration would lose most people, so the
 * page is staged, and each stage only appears once the previous one is done:
 *
 * 1. **Paste a key.** The only step that is just typing.
 * 2. **Test it.** The direct attempt runs and fails — visibly. This is the point
 *    of the whole design: the user *sees* that the service refuses browsers
 *    rather than being told, so the proxy request that follows is something they
 *    understood before agreeing to it.
 * 3. **Set up a proxy**, if they have not. The test names this as the next step.
 * 4. **Consent**, with the disclosure that names the operator and the concrete
 *    risk.
 * 5. **Test again**, which now succeeds. Only then is this "connected".
 *
 * ## Connected means verified, not "key pasted"
 *
 * Same rule as the link shortener page, and it matters more here: a valid key is
 * genuinely useless without a working header-forwarding proxy, so storing one
 * and showing a green tick would be a lie in the *normal* case rather than an
 * edge case.
 */
@Component({
  selector: 'app-connection-twitter',
  imports: [FormsModule, RouterLink, TwitterConsentDialog],
  templateUrl: './connection-twitter.html',
  styleUrls: ['../connection-page.css', './connection-twitter.css'],
})
export class ConnectionTwitter implements OnInit {
  protected settings = inject(TwitterSettings);
  protected consent = inject(ProxyConsent);
  private proxy = inject(CorsProxy);
  private reachability = inject(TwitterReachability);

  protected readonly sources = availableTwitterSources();
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.browser.detail;
  protected readonly expiryLabel = expiryLabel;

  /** Which source's setup form is open. Defaults to the active one. */
  protected readonly selected = signal<TwitterSourceId>(
    this.settings.activeId() ?? this.sources[0].id,
  );

  protected readonly entry = computed<TwitterSourceEntry>(
    () => this.sources.find((item) => item.id === this.selected()) ?? this.sources[0],
  );

  /** Draft key. Never prefilled from storage — a stored key is not readable back. */
  protected readonly keyDraft = signal('');

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Set while the consent dialog is open. */
  protected readonly consentPrompt = signal<{
    source: TwitterSourceEntry;
    proxy: CorsProxyEntry;
  } | null>(null);

  /** The most recent reachability verdict, shown under the actions row. */
  protected readonly lastProbe = signal<TwitterReachabilityResult | null>(null);

  /** The proxy in play, for the page to name it. */
  protected readonly proxyEntry = computed(() => this.proxy.entry());

  /**
   * Whether the configured proxy can carry an API key.
   *
   * The single most valuable thing this page can tell someone. A proxy that
   * strips custom headers makes a perfectly good key look rejected, and the user
   * has no way to know — so it is called out *before* they waste a test on it.
   */
  protected readonly proxyStripsHeaders = computed(
    () => this.proxyEntry()?.forwardsCustomHeaders === false,
  );

  /** Whether the proxy needs the user's domain registered before it will answer. */
  protected readonly proxyNeedsRegistration = computed(
    () => this.proxyEntry()?.originAllowlist ?? null,
  );

  /** Has a key been stored for this source? */
  protected hasKey(id: TwitterSourceId): boolean {
    return this.settings.hasKey(id);
  }

  protected isActive(id: TwitterSourceId): boolean {
    return this.settings.activeId() === id;
  }

  /**
   * Whether this source is actually usable: key stored, proxy consented, and a
   * successful probe on record.
   *
   * Deliberately strict. Anything less has been observed to produce a green tick
   * next to a feature that fails on every use.
   */
  protected readonly working = computed(() => {
    const probe = this.lastProbe();
    return probe?.status === 'proxy' || probe?.status === 'direct';
  });

  /** What the user should do next, in one sentence. Drives the checklist. */
  protected readonly nextStep = computed<string | null>(() => {
    if (!this.settings.hasKey(this.entry().id)) {
      return 'Paste your API key below.';
    }
    if (this.settings.directReachability(this.entry().id) === 'untested') {
      return 'Press Test connection — the first attempt goes direct, and is expected to fail.';
    }
    if (!this.proxy.available()) {
      return 'Set up a CORS proxy, then test again.';
    }
    if (this.proxyStripsHeaders()) {
      return 'Your CORS proxy cannot carry API keys. Switch to one that can.';
    }
    if (!this.hasConsent()) {
      return 'Test again and accept the disclosure, so requests may use your proxy.';
    }
    return null;
  });

  /**
   * Apply the retention policy when this page is reached directly.
   *
   * The Connections hub governs the full set of connectors, but a deep link (or
   * a bookmark) never passes through it. This key spends money, so it should not
   * outlive the policy just because the user's route into the page skipped the
   * one component that enforces it.
   */
  ngOnInit(): void {
    this.settings.enforceLifetime();
  }

  protected choose(id: TwitterSourceId): void {
    this.selected.set(id);
    this.keyDraft.set('');
    this.notice.set(null);
    this.error.set(null);
    // A verdict belongs to the source it was measured against.
    this.lastProbe.set(null);
  }

  /** Store the key and immediately test it. Saving without testing proves nothing. */
  protected async save(): Promise<void> {
    const entry = this.entry();
    const key = this.keyDraft().trim();
    if (!key) {
      this.error.set(`Paste your ${entry.label} API key first.`);
      return;
    }
    this.settings.setKey(entry.id, key);
    this.settings.activate(entry.id);
    this.keyDraft.set('');
    await this.test();
  }

  /**
   * Run the probe and interpret the verdict.
   *
   * Costs up to two billable requests — one direct, one proxied — which the
   * template states next to the button before it is pressed. The direct one
   * usually dies at the preflight and never reaches the service, so in practice
   * it is usually one.
   */
  protected async test(): Promise<void> {
    const entry = this.entry();
    if (!this.settings.hasKey(entry.id)) {
      this.error.set(`Paste your ${entry.label} API key first.`);
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const result = await firstValueFrom(this.reachability.probe());
      this.lastProbe.set(result);

      if (result.status === 'proxy' || result.status === 'direct') {
        this.notice.set(result.message);
        return;
      }
      if (result.status === 'needs-consent') {
        const proxy = this.proxy.entry();
        if (proxy) {
          this.consentPrompt.set({ source: entry, proxy });
          return;
        }
      }
      this.error.set(result.message);
    } finally {
      this.busy.set(false);
    }
  }

  /** The user accepted the disclosure: record it and retry, which should now work. */
  protected async acceptConsent(): Promise<void> {
    const prompt = this.consentPrompt();
    this.consentPrompt.set(null);
    if (!prompt) {
      return;
    }
    this.consent.grant(prompt.source.id, prompt.proxy.id);
    await this.test();
  }

  protected declineConsent(): void {
    const prompt = this.consentPrompt();
    this.consentPrompt.set(null);
    if (prompt) {
      this.error.set(
        `Nothing was sent through ${prompt.proxy.label}. Without a proxy, X data cannot be read ` +
          `from a browser at all — so this connection stays off until you either consent or ` +
          `configure a proxy you trust.`,
      );
    }
  }

  protected hasConsent(): boolean {
    const proxy = this.proxy.entry();
    const active = this.settings.activeId();
    return proxy && active ? this.consent.granted(active, proxy.id) : false;
  }

  /** Withdraw consent, so the next request asks again. */
  protected revokeConsent(): void {
    const proxy = this.proxy.entry();
    const active = this.settings.activeId();
    if (proxy && active) {
      this.consent.revoke(active, proxy.id);
      this.lastProbe.set(null);
      this.notice.set('Consent withdrawn. You will be asked again next time.');
    }
  }

  /** Forget this source entirely: key, probe verdict, and proxy consents. */
  protected forget(id: TwitterSourceId): void {
    this.settings.forget(id);
    this.consent.revokeAll(id);
    this.keyDraft.set('');
    this.lastProbe.set(null);
    this.notice.set('Disconnected. Your API key has been removed from this browser.');
    this.error.set(null);
  }
}
