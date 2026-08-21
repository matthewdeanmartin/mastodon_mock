/** Import low-churn connector credentials already present in this browser. */

import { inject, Injectable } from '@angular/core';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { GitHubSession } from '../github/github-session';
import { HugoSettings } from '../hugo/hugo-settings';
import { MataroaSettings } from '../mataroa/mataroa-settings';
import { OpenRouterSession } from '../openrouter/openrouter-session';
import { GistSettings } from '../paste/gist-settings';
import { RaindropSession } from '../raindrop/raindrop-session';
import { ShortenerSettings } from '../shortener/shortener-settings';
import { TwitterSettings } from '../twitter/twitter-settings';
import type { SyncOutcome } from './vault-bridge';

export interface VaultAdoptionResult {
  stored: string[];
  failed: { connector: string; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class VaultAdoption {
  private openRouter = inject(OpenRouterSession);
  private corsProxy = inject(CorsProxySettings);
  private shorteners = inject(ShortenerSettings);
  private raindrop = inject(RaindropSession);
  private twitter = inject(TwitterSettings);
  private mataroa = inject(MataroaSettings);
  private hugo = inject(HugoSettings);
  private github = inject(GitHubSession);
  private gist = inject(GistSettings);

  /**
   * Sequential on purpose: every successful call advances one shared vault
   * version. Parallel writes would manufacture conflicts between credentials
   * being imported by the same click.
   */
  async adoptExisting(): Promise<VaultAdoptionResult> {
    const sources: readonly [string, () => Promise<SyncOutcome>][] = [
      ['OpenRouter', () => this.openRouter.syncToVault()],
      ['CORS proxy', () => this.corsProxy.syncToVault()],
      ['Link shorteners', () => this.shorteners.syncToVault()],
      ['Raindrop', () => this.raindrop.syncToVault()],
      ['Twitter', () => this.twitter.syncToVault()],
      ['Mataroa', () => this.mataroa.syncToVault()],
      ['Hugo', () => this.hugo.syncToVault()],
      ['GitHub', () => this.github.syncToVault()],
      ['GitHub Gist', () => this.gist.syncToVault()],
    ];
    const stored: string[] = [];
    const failed: VaultAdoptionResult['failed'] = [];

    for (const [connector, sync] of sources) {
      try {
        const outcome = await sync();
        if (outcome.kind === 'stored') {
          stored.push(connector);
        } else if (outcome.kind === 'failed') {
          failed.push({ connector, message: outcome.message });
        }
      } catch (error) {
        failed.push({
          connector,
          message: error instanceof Error ? error.message : 'Unexpected connector error.',
        });
      }
    }
    return { stored, failed };
  }
}
