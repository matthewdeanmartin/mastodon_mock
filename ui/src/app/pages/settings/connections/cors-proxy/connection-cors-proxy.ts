import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import {
  availableCorsProxies,
  CorsProxyEntry,
  CorsProxyId,
  isDevelopmentOrigin,
} from '../../../../providers/cors-proxy/cors-proxy-catalog';
import { CorsProxySettings } from '../../../../providers/cors-proxy/cors-proxy-settings';
import { buildProxiedUrl, proxyHeaders } from '../../../../providers/cors-proxy/cors-proxy';
import { externalFetch } from '../../../../providers/external-fetch';
import { expiryLabel } from '../expiry-label';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';

/**
 * A small, stable, genuinely public feed to prove a proxy works.
 *
 * The W3C's news feed is a deliberate choice: it is public, it is not going
 * anywhere, it is small enough that a failed test costs nothing, and it belongs
 * to nobody involved here — testing against the user's own feeds would leak
 * which ones they read to a proxy they may be about to reject.
 */
const TEST_FEED_URL = 'https://www.w3.org/blog/news/feed';

/** How long to wait before calling a proxy too slow to be useful. */
const TEST_TIMEOUT_MS = 15_000;

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; ms: number }
  | { status: 'failed'; message: string };

/**
 * Settings → Connections → CORS proxy.
 *
 * The page has to do something none of the other connection pages do: talk the
 * user out of a bad default. The free proxies are the ones people reach for and
 * the ones that vanish, rate-limit, or read your traffic, so the copy is
 * explicit about what each one costs and the custom option is presented as the
 * one that actually keeps working.
 */
@Component({
  selector: 'app-connection-cors-proxy',
  imports: [FormsModule, RouterLink],
  templateUrl: './connection-cors-proxy.html',
  styleUrls: ['../connection-page.css', './connection-cors-proxy.css'],
})
export class ConnectionCorsProxy implements OnInit {
  protected settings = inject(CorsProxySettings);
  private http = inject(HttpClient);

  protected readonly expiryLabel = expiryLabel;
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.browser.detail;
  protected readonly isDevOrigin = isDevelopmentOrigin();
  protected readonly proxies = availableCorsProxies();

  /** Form state, seeded from storage and written back only on save. */
  protected selectedId = signal<CorsProxyId | null>(this.settings.currentId());
  protected apiKey = signal('');
  protected customTemplate = signal(this.settings.customTemplate());
  protected customHeader = signal(this.settings.customHeader());
  protected customEncode = signal(this.settings.customEncodeTarget());

  protected notice = signal<string | null>(null);
  protected error = signal<string | null>(null);
  protected test = signal<TestState>({ status: 'idle' });
  /** Set when a dev-only selection was dropped because this build is deployed. */
  protected droppedSelection = signal(false);

  protected readonly selected = computed<CorsProxyEntry | null>(() => {
    const id = this.selectedId();
    return id ? (this.proxies.find((entry) => entry.id === id) ?? null) : null;
  });

  protected readonly isCustom = computed(() => this.selectedId() === 'custom');

  /**
   * True when the proxy on screen is not the one a test would actually use.
   *
   * {@link choose} commits most selections immediately, so this is only ever
   * reachable for the two that cannot be committed on selection alone: custom
   * before its template is saved, and a key-required proxy before its key is
   * pasted. Those are exactly the states where a Test result would describe the
   * wrong service, so the button is disabled and the reason is on screen.
   */
  protected readonly pendingSelection = computed(() => {
    const id = this.selectedId();
    return id !== null && id !== this.settings.currentId();
  });

  /** Whether the chosen proxy has anywhere to put a key. */
  protected readonly takesKey = computed(() => {
    const entry = this.selected();
    if (!entry) {
      return false;
    }
    return entry.id === 'custom' || entry.keyHeader !== undefined;
  });

  /**
   * The exact URL the current form would produce, so a misplaced `{url}` is
   * visible before it costs the user a confusing failure.
   */
  protected readonly preview = computed(() => {
    const entry = this.selected();
    if (!entry) {
      return null;
    }
    const pattern = entry.id === 'custom' ? this.customTemplate().trim() : entry.template.pattern;
    if (!pattern.includes('{url}')) {
      return null;
    }
    const encodeTarget = entry.id === 'custom' ? this.customEncode() : entry.template.encodeTarget;
    return buildProxiedUrl(
      { entry, pattern, encodeTarget, header: null },
      'https://example.com/feed.xml',
    );
  });

  ngOnInit(): void {
    // Deep-link case: re-check the key against a policy shortened on the
    // catalog page, and drop a localhost-only proxy chosen during development
    // that cannot work on this origin.
    this.settings.enforceLifetime();
    if (this.settings.dropUnavailableSelection()) {
      this.droppedSelection.set(true);
      this.selectedId.set(null);
    }
  }

  /**
   * Switch proxies, and commit the switch straight away when it is complete.
   *
   * The Test button tests what is *saved*, which is right — feeds use the saved
   * configuration, so testing unsaved form state would be a lie. But combined
   * with a selection that only took effect on Save, it produced the worst
   * possible reading: pick CORS.SH, press Test, watch a request go to the proxy
   * you just moved away from. Nothing on screen said the old one was still the
   * live one, so the picker looked broken and sticky.
   *
   * The link-shortener page does not have this problem, because choosing a
   * provider that needs nothing further activates it. Same rule here: for a
   * catalog proxy with no key to type, the radio button *is* the configuration,
   * so selecting it saves it. Custom still waits for Save — it is not
   * configured until a template exists — and so does a key-required proxy with
   * no key yet, since committing it would leave the app with a proxy it cannot
   * resolve.
   */
  choose(id: CorsProxyId): void {
    this.selectedId.set(id);
    this.test.set({ status: 'idle' });
    this.notice.set(null);
    this.error.set(null);

    const entry = this.selected();
    if (!entry || entry.id === 'custom') {
      return;
    }
    if (entry.keyRequired && !this.settings.hasKey()) {
      // Selecting it is not enough to make it work; leave the previous
      // selection in place rather than saving a proxy that resolves to null.
      return;
    }
    this.settings.select(entry.id);
    this.notice.set(`${entry.label} is now the active proxy.`);
  }

  save(): void {
    const entry = this.selected();
    this.error.set(null);
    this.notice.set(null);
    this.test.set({ status: 'idle' });

    if (!entry) {
      this.error.set('Choose a proxy first.');
      return;
    }
    if (entry.id === 'custom' && !this.customTemplate().includes('{url}')) {
      this.error.set(
        'A custom proxy URL must contain {url} where the address being fetched should go.',
      );
      return;
    }

    this.settings.select(entry.id, {
      template: this.customTemplate(),
      encodeTarget: this.customEncode(),
    });

    // An untouched key field leaves the stored key alone: re-selecting a proxy
    // should not silently wipe a key the user pasted a month ago.
    const typedKey = this.apiKey().trim();
    if (typedKey) {
      this.settings.setKey(typedKey, this.customHeader());
      this.apiKey.set('');
    } else if (
      entry.id === 'custom' &&
      this.customHeader().trim() !== this.settings.customHeader()
    ) {
      // Header renamed without a new key: keep the key, move it to the new header.
      this.settings.setKey(this.storedKeyOrEmpty(), this.customHeader());
    }

    if (entry.keyRequired && !this.settings.hasKey()) {
      this.error.set(`${entry.label} needs an API key before it will answer any request.`);
      return;
    }
    this.notice.set(`${entry.label} saved. Turn it on per feed under Settings → RSS.`);
  }

  clearKey(): void {
    this.settings.clearKey();
    this.apiKey.set('');
    this.notice.set('API key removed from this browser.');
  }

  disconnect(): void {
    this.settings.clear();
    this.selectedId.set(null);
    this.apiKey.set('');
    this.test.set({ status: 'idle' });
    this.notice.set('No proxy configured. Feeds are fetched directly again.');
  }

  /**
   * Fetch one known public feed through the saved configuration.
   *
   * Tests what is *saved* rather than what is typed, because that is what feeds
   * will use — a test that passed against unsaved form state would be a lie.
   */
  runTest(): void {
    const config = this.settings.resolve();
    if (!config) {
      this.error.set('Save a working configuration before testing it.');
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    this.test.set({ status: 'running' });

    const startedAt = Date.now();
    this.http
      .get(buildProxiedUrl(config, TEST_FEED_URL), {
        responseType: 'text',
        context: externalFetch(),
        headers: proxyHeaders(config),
      })
      .pipe(
        timeout(TEST_TIMEOUT_MS),
        map((body) => ({ ok: body.includes('<'), body })),
        catchError((err: unknown) => of({ ok: false, error: err })),
      )
      .subscribe((result) => {
        const ms = Date.now() - startedAt;
        if ('error' in result) {
          this.test.set({ status: 'failed', message: describeTestFailure(result.error) });
          return;
        }
        if (!result.ok) {
          this.test.set({
            status: 'failed',
            message:
              'The proxy answered, but not with a feed. It may have returned its own error page — check any key or quota.',
          });
          return;
        }
        this.test.set({ status: 'ok', ms });
      });
  }

  /**
   * The stored key, for the header-rename path above.
   *
   * {@link CorsProxySettings} deliberately exposes only `hasKey()`, so this
   * reaches for the resolved config instead of widening that surface.
   */
  private storedKeyOrEmpty(): string {
    return this.settings.resolve()?.header?.value ?? '';
  }
}

function describeTestFailure(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return "Couldn't reach the proxy at all. It may be down, blocking this origin, or the URL may be wrong.";
    }
    if (err.status === 401 || err.status === 403) {
      return `The proxy rejected the request (${err.status}). It needs a key, or the key is wrong or out of quota.`;
    }
    if (err.status === 429) {
      return 'The proxy is rate-limiting this browser right now.';
    }
    return `The proxy answered ${err.status}.`;
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return 'The proxy did not answer within 15 seconds. It is up but too slow to read feeds through.';
  }
  return err instanceof Error ? err.message : 'The test failed for an unknown reason.';
}
