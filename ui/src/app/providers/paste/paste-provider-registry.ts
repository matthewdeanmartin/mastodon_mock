import { inject, Injectable } from '@angular/core';
import { CentosProvider } from './centos-provider';
import { OpensuseProvider } from './opensuse-provider';
import { FeedPasteProvider, PasteProvider } from './paste-provider';
import { PastepileProvider } from './pastepile-provider';
import { RentryProvider } from './rentry-provider';
import { TinyurlProvider } from './tinyurl-provider';

/** Available paste services. Keeping selection here makes a second service additive. */
@Injectable({ providedIn: 'root' })
export class PasteProviderRegistry {
  private pastepile = inject(PastepileProvider);
  private rentry = inject(RentryProvider);
  private tinyurl = inject(TinyurlProvider);
  private opensuse = inject(OpensuseProvider);
  private centos = inject(CentosProvider);

  // Rentry leads and is the default: it is CORS-clean and editable. Pastepile is
  // kept for its public feed but has been returning a CORS-less 308 (effectively
  // offline), so it must not be the default a fresh composer posts to.
  //
  // openSUSE is deliberately absent: it is feed-only (no create API), and a
  // destination the composer cannot actually post to has no business in this
  // list. CentOS can create, so it is here — it simply refuses until a key is set.
  readonly all: readonly PasteProvider[] = [this.rentry, this.tinyurl, this.pastepile, this.centos];

  /**
   * Providers offering a public feed to subscribe to.
   *
   * Every one of these is CORS-blocked at the origin, so reading them requires
   * the user's own proxy, opted in per feed. That is why they are listed
   * separately from `all` rather than inferred: appearing here is a claim that
   * a feed exists, not that it can be read without setup.
   */
  readonly feeds: readonly FeedPasteProvider[] = [this.pastepile, this.opensuse, this.centos];

  // Typed as the interface (not RentryProvider) so callers keep the full
  // visibility union; narrowing to one provider's literal types breaks them.
  readonly default: PasteProvider = this.rentry;

  get(id: string): PasteProvider | undefined {
    return this.all.find((provider) => provider.id === id);
  }

  /** A feed provider by id, including feed-only ones absent from `all`. */
  feed(id: string): FeedPasteProvider | undefined {
    return this.feeds.find((provider) => provider.id === id);
  }
}
