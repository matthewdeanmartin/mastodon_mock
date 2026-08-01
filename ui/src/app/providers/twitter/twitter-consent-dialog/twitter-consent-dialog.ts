import { Component, computed, input, output } from '@angular/core';
import { CorsProxyEntry } from '../../cors-proxy/cors-proxy-catalog';
import { TwitterSourceEntry } from '../twitter-source';

/**
 * Asks permission to send a Twitter data-service API key through a CORS proxy.
 *
 * ## Why this is not the shortener's consent dialog
 *
 * It very nearly is, and the structure is deliberately the same — who you are
 * trusting, what could go wrong, what this does not cover. But two things about
 * this case differ enough that reusing the shortener copy would understate the
 * ask:
 *
 * 1. **The key spends money.** A shortener key creates and deletes links. This
 *    one draws down a prepaid credit balance, so a leaked key has a direct
 *    financial cost that stops only when the user notices and rotates it.
 *
 * 2. **Every read goes through the proxy, so the proxy sees the user's reading
 *    history.** The shortener case disclosed the destination URLs someone chose
 *    to publish. This one discloses which Twitter accounts a person follows, reads,
 *    and searches for — private behaviour they never intended to publish, and
 *    exactly the sort of thing §19 of the spec requires be disclosed.
 *
 * The second point is the one users will not anticipate on their own, so it is
 * stated first and in its own section rather than folded into a risk list.
 *
 * ## The self-hosted case is deliberately calm
 *
 * Same reasoning as the shortener dialog: when the proxy is the user's own,
 * their server seeing their own key is not a disclosure. Wrapping that in red
 * warning text would be false, and it teaches users that the red text in this
 * app is decorative — which is the fastest way to make the *real* warning stop
 * working.
 *
 * ## Why there is no "remember this" checkbox
 *
 * Consent *is* remembered — that is what {@link ProxyConsent} stores. The
 * absence is of the opposite affordance: there is no way to proceed without
 * recording it, because an unrecorded grant would mean asking on every request,
 * and a dialog shown on every request is one nobody reads.
 */
@Component({
  selector: 'app-twitter-consent-dialog',
  imports: [],
  templateUrl: './twitter-consent-dialog.html',
  styleUrls: ['../../shortener/proxy-consent-dialog/proxy-consent-dialog.css'],
})
export class TwitterConsentDialog {
  /** The service whose key would travel through the proxy. */
  readonly source = input.required<TwitterSourceEntry>();
  /** The configured proxy, whose operator would see it. */
  readonly proxy = input.required<CorsProxyEntry>();

  readonly accepted = output<void>();
  readonly cancelled = output<void>();

  /** True when the proxy is one the user runs, so no disclosure is happening. */
  protected readonly selfHosted = computed(() => this.proxy().id === 'custom');
}
