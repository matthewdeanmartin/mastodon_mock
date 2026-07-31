import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CorsProxy } from '../../../../providers/cors-proxy/cors-proxy';
import { CorsProxyEntry } from '../../../../providers/cors-proxy/cors-proxy-catalog';
import { ProxyConsentDialog } from '../../../../providers/shortener/proxy-consent-dialog/proxy-consent-dialog';
import { ShortenerProxyConsent } from '../../../../providers/shortener/proxy-consent';
import {
  SHORTENER_CATALOG,
  ShortenerCatalogEntry,
} from '../../../../providers/shortener/shortener-catalog';
import { ShortenerHistory } from '../../../../providers/shortener/shortener-history';
import { ShortenerId } from '../../../../providers/shortener/shortener-provider';
import { ShortenerRegistry } from '../../../../providers/shortener/shortener-registry';
import { ShortenerSettings } from '../../../../providers/shortener/shortener-settings';
import { ProxyConsentRequired } from '../../../../providers/shortener/shortener-transport';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { expiryLabel } from '../expiry-label';

/**
 * Settings → Connections → Link shortener.
 *
 * ## Connect means verified, not "key pasted"
 *
 * The one rule this page exists to enforce. Storing a key and calling that
 * "connected" would be a lie in the common case: these APIs mostly refuse
 * browsers, so a perfectly valid key can still be useless here. Saving without
 * checking would leave the user with a green tick and a Links page that fails on
 * every action, with nothing pointing at the cause.
 *
 * So {@link save} runs the real sequence:
 *
 * 1. Store the key provisionally — the transport reads it from settings, so it
 *    has to be there to make the call at all.
 * 2. Call the provider's cheapest authenticated endpoint.
 * 3. On success, keep it. That is a connection.
 * 4. On a *credential* failure, roll the key back out of storage. A rejected key
 *    is not worth keeping, and leaving it would age into a mystery later.
 * 5. On a CORS failure, do not roll back yet — ask about the proxy, and retry if
 *    the user consents. The key may well be fine.
 *
 * Only step 5 needs the dialog, and the dialog only appears when a proxy is
 * actually configured. Without one there is nothing to consent to, so the page
 * says what to go and do instead.
 */
@Component({
  selector: 'app-connection-link-shortener',
  imports: [FormsModule, RouterLink, ProxyConsentDialog],
  templateUrl: './connection-link-shortener.html',
  styleUrls: ['../connection-page.css', './connection-link-shortener.css'],
})
export class ConnectionLinkShortener {
  protected settings = inject(ShortenerSettings);
  protected registry = inject(ShortenerRegistry);
  protected consent = inject(ShortenerProxyConsent);
  private proxy = inject(CorsProxy);
  private history = inject(ShortenerHistory);

  protected readonly catalog = SHORTENER_CATALOG;
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.browser.detail;
  protected readonly expiryLabel = expiryLabel;

  /** Which provider's setup form is open. Defaults to the active one. */
  protected readonly selected = signal<ShortenerId>(this.settings.activeId() ?? 'dub');

  protected readonly entry = computed<ShortenerCatalogEntry>(
    () => this.catalog.find((item) => item.id === this.selected()) ?? this.catalog[0],
  );

  /** Draft key. Never prefilled from storage — a stored key is not readable back. */
  protected readonly keyDraft = signal('');
  protected readonly domainDraft = signal(this.settings.domain(this.selected()));

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Set while the consent dialog is open; holds what the retry needs. */
  protected readonly consentPrompt = signal<{
    shortener: ShortenerCatalogEntry;
    proxy: CorsProxyEntry;
  } | null>(null);

  /** The proxy in play, for the "already consented" note on the page. */
  protected readonly proxyEntry = computed(() => this.proxy.entry());

  protected choose(id: ShortenerId): void {
    this.selected.set(id);
    this.keyDraft.set('');
    this.domainDraft.set(this.settings.domain(id));
    this.notice.set(null);
    this.error.set(null);
  }

  protected connected(id: ShortenerId): boolean {
    return this.settings.hasKey(id);
  }

  protected isActive(id: ShortenerId): boolean {
    return this.settings.activeId() === id;
  }

  /** Make an already-configured provider the active one. */
  protected activate(id: ShortenerId): void {
    this.settings.activate(id);
    this.notice.set(`${this.entryFor(id).label} is now the active shortener.`);
    this.error.set(null);
  }

  /**
   * Save and verify. See the class note for why these are one action.
   */
  protected async save(): Promise<void> {
    const entry = this.entry();
    const key = this.keyDraft().trim();
    if (!key) {
      this.error.set(`Paste your ${entry.label} ${entry.keyLabel} first.`);
      return;
    }
    if (entry.domainRequired && !this.domainDraft().trim()) {
      this.error.set(`${entry.label} needs the short domain from your account.`);
      return;
    }

    const hadKey = this.settings.hasKey(entry.id);
    this.settings.setKey(entry.id, key);
    this.settings.setDomain(entry.id, this.domainDraft());
    this.settings.activate(entry.id);

    await this.verify({ rollbackTo: hadKey ? 'keep' : 'clear' });
  }

  /**
   * Run the provider's verify call and interpret the outcome.
   *
   * `rollbackTo` says what to do with the key if this turns out to be a bad
   * credential: `clear` when we just added it (leave no junk behind), `keep`
   * when the user already had a working one and is only re-testing.
   */
  private async verify(options: { rollbackTo: 'clear' | 'keep' }): Promise<void> {
    const entry = this.entry();
    const provider = this.registry.get(entry.id);
    if (!provider) {
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await firstValueFrom(provider.verify());
      this.keyDraft.set('');
      this.notice.set(`Connected to ${entry.label}. Your key works from this browser.`);
    } catch (error: unknown) {
      if (error instanceof ProxyConsentRequired) {
        this.handleProxyNeeded(error, entry);
        return;
      }
      if (options.rollbackTo === 'clear') {
        // A key that does not work is not kept. See the class note.
        this.settings.clearKey(entry.id);
      }
      this.error.set(describeError(error, `Couldn't reach ${entry.label}.`));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The CORS branch: either point at the proxy settings, or ask for consent.
   *
   * The key is deliberately left in storage here. It has not been shown to be
   * bad — it has not been *tested* — and throwing it away would make the user
   * paste it again after configuring a proxy, for no gain.
   */
  private handleProxyNeeded(error: ProxyConsentRequired, entry: ShortenerCatalogEntry): void {
    if (error.noProxyConfigured) {
      this.error.set(
        `${entry.label}'s API doesn't answer web browsers directly, so Mawkingbird needs a CORS ` +
          `proxy to reach it. Set one up under CORS proxy, then come back and test again.`,
      );
      return;
    }
    const proxy = this.proxy.entry();
    if (!proxy) {
      return;
    }
    this.consentPrompt.set({ shortener: entry, proxy });
  }

  /** The user accepted the disclosure: record it and retry the same check. */
  protected async acceptConsent(): Promise<void> {
    const prompt = this.consentPrompt();
    this.consentPrompt.set(null);
    if (!prompt) {
      return;
    }
    this.consent.grant(prompt.shortener.id, prompt.proxy.id);
    // Retry with `keep`: the key is untested, not known-bad, so a second CORS
    // failure should not discard it.
    await this.verify({ rollbackTo: 'keep' });
  }

  protected declineConsent(): void {
    const prompt = this.consentPrompt();
    this.consentPrompt.set(null);
    if (prompt) {
      this.error.set(
        `Not connected. ${prompt.shortener.label} can't be reached from this browser without ` +
          `sending your key through ${prompt.proxy.label}.`,
      );
    }
  }

  /** Re-test an existing connection without re-pasting the key. */
  protected async test(): Promise<void> {
    await this.verify({ rollbackTo: 'keep' });
  }

  /** Withdraw a consent, so the next proxied request asks again. */
  protected revokeConsent(shortener: ShortenerId): void {
    const proxy = this.proxy.entry();
    if (proxy) {
      this.consent.revoke(shortener, proxy.id);
      this.notice.set('Consent withdrawn. You will be asked again next time.');
    }
  }

  protected hasConsent(id: ShortenerId): boolean {
    const proxy = this.proxy.entry();
    return proxy ? this.consent.granted(id, proxy.id) : false;
  }

  /** Forget a provider entirely: key, domain, consent, and local link history. */
  protected forget(id: ShortenerId): void {
    this.settings.forget(id);
    this.consent.revokeAll(id);
    this.history.clearProvider(id);
    this.keyDraft.set('');
    this.domainDraft.set('');
    this.notice.set(`${this.entryFor(id).label} disconnected and its saved links cleared.`);
    this.error.set(null);
  }

  private entryFor(id: ShortenerId): ShortenerCatalogEntry {
    return this.catalog.find((item) => item.id === id) ?? this.catalog[0];
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
