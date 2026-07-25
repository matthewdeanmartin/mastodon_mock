import { inject, Injectable } from '@angular/core';
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

  // Rentry leads and is the default: it is CORS-clean and editable. Pastepile is
  // kept for its public feed but has been returning a CORS-less 308 (effectively
  // offline), so it must not be the default a fresh composer posts to.
  readonly all: readonly PasteProvider[] = [this.rentry, this.tinyurl, this.pastepile];
  readonly feeds: readonly FeedPasteProvider[] = [this.pastepile];
  // Typed as the interface (not RentryProvider) so callers keep the full
  // visibility union; narrowing to one provider's literal types breaks them.
  readonly default: PasteProvider = this.rentry;

  get(id: string): PasteProvider | undefined {
    return this.all.find((provider) => provider.id === id);
  }
}
