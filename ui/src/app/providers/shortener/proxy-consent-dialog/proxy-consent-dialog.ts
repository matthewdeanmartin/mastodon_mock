import { Component, computed, input, output } from '@angular/core';
import { CorsProxyEntry } from '../../cors-proxy/cors-proxy-catalog';
import { ShortenerCatalogEntry } from '../shortener-catalog';

/**
 * Asks permission to send a shortener API key through a CORS proxy.
 *
 * ## Why this is not the generic confirm dialog
 *
 * Because the generic one cannot ask this question honestly. A modal that says
 * "Send your API key through the proxy? [Cancel] [Confirm]" is not consent — the
 * user has no way to evaluate it. Nobody can weigh a risk without knowing who
 * they are taking it with and what specifically could go wrong.
 *
 * So this dialog is built around the three things a person actually needs:
 *
 * 1. **Who.** The proxy operator by name, with links to their front page and
 *    privacy policy, so the user can go and look. A name alone ("AllOrigins")
 *    means nothing to most people; a name plus a policy they can read is a
 *    decision they can make.
 * 2. **What could go wrong.** Concretely, in the terms of this app: whoever runs
 *    the proxy can read the key, and a key for this service can create links,
 *    delete links, and read the links already in the account. Not "may
 *    compromise your credentials" — what the credential actually does.
 * 3. **What it does not cover.** The key is scoped to the shortener. It is not
 *    the user's Mastodon account, and the app still refuses to proxy that.
 *    Saying so keeps the warning proportionate, which is what makes it worth
 *    reading.
 *
 * ## The self-hosted case is deliberately calm
 *
 * When the configured proxy is the user's own (`custom`), the same information
 * is presented without alarm: their server seeing their own key is not a
 * disclosure. Wrapping that in red warning text would be false, and it would
 * teach the user that the red text in this app is decorative — which is the
 * fastest way to make the *real* warning stop working.
 */
@Component({
  selector: 'app-proxy-consent-dialog',
  imports: [],
  templateUrl: './proxy-consent-dialog.html',
  styleUrls: ['./proxy-consent-dialog.css'],
})
export class ProxyConsentDialog {
  /** The shortener whose key would travel through the proxy. */
  readonly shortener = input.required<ShortenerCatalogEntry>();
  /** The configured proxy, whose operator would see it. */
  readonly proxy = input.required<CorsProxyEntry>();
  /** Whether this request includes a shortener API credential. */
  readonly carriesCredential = input(true);

  readonly accepted = output<void>();
  readonly cancelled = output<void>();

  /** True when the proxy is one the user runs, so no disclosure is happening. */
  protected readonly selfHosted = computed(() => this.proxy().id === 'custom');
}
