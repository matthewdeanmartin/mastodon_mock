import { inject, Injectable } from '@angular/core';
import { FeedPasteProvider, PasteProvider } from './paste-provider';
import { PastepileProvider } from './pastepile-provider';
import { RentryProvider } from './rentry-provider';

/** Available paste services. Keeping selection here makes a second service additive. */
@Injectable({ providedIn: 'root' })
export class PasteProviderRegistry {
  private pastepile = inject(PastepileProvider);
  private rentry = inject(RentryProvider);

  readonly all: readonly PasteProvider[] = [this.pastepile, this.rentry];
  readonly feeds: readonly FeedPasteProvider[] = [this.pastepile];
  readonly default = this.pastepile;

  get(id: string): PasteProvider | undefined {
    return this.all.find((provider) => provider.id === id);
  }
}
