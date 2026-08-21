import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { GitHubSession } from '../github/github-session';
import { HugoSettings } from '../hugo/hugo-settings';
import { MataroaSettings } from '../mataroa/mataroa-settings';
import { OpenRouterSession } from '../openrouter/openrouter-session';
import { GistSettings } from '../paste/gist-settings';
import { RaindropSession } from '../raindrop/raindrop-session';
import { ShortenerSettings } from '../shortener/shortener-settings';
import { TwitterSettings } from '../twitter/twitter-settings';
import { VaultAdoption } from './vault-adoption';

describe('VaultAdoption', () => {
  const order: string[] = [];
  const stored = (name: string) =>
    vi.fn(async () => {
      order.push(name);
      return { kind: 'stored' as const, overwritten: [] };
    });
  const skipped = (name: string) =>
    vi.fn(async () => {
      order.push(name);
      return { kind: 'skipped' as const };
    });

  beforeEach(() => {
    order.length = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: OpenRouterSession, useValue: { syncToVault: stored('OpenRouter') } },
        { provide: CorsProxySettings, useValue: { syncToVault: skipped('CORS proxy') } },
        { provide: ShortenerSettings, useValue: { syncToVault: stored('Link shorteners') } },
        { provide: RaindropSession, useValue: { syncToVault: skipped('Raindrop') } },
        { provide: TwitterSettings, useValue: { syncToVault: skipped('Twitter') } },
        { provide: MataroaSettings, useValue: { syncToVault: stored('Mataroa') } },
        {
          provide: HugoSettings,
          useValue: {
            syncToVault: vi.fn(async () => {
              order.push('Hugo');
              throw new Error('storage unavailable');
            }),
          },
        },
        {
          provide: GitHubSession,
          useValue: {
            syncToVault: vi.fn(async () => {
              order.push('GitHub');
              return { kind: 'failed' as const, message: 'conflict' };
            }),
          },
        },
        { provide: GistSettings, useValue: { syncToVault: skipped('GitHub Gist') } },
      ],
    });
  });

  it('imports each connector sequentially and reports stored and failed entries', async () => {
    const result = await TestBed.inject(VaultAdoption).adoptExisting();

    expect(order).toEqual([
      'OpenRouter',
      'CORS proxy',
      'Link shorteners',
      'Raindrop',
      'Twitter',
      'Mataroa',
      'Hugo',
      'GitHub',
      'GitHub Gist',
    ]);
    expect(result.stored).toEqual(['OpenRouter', 'Link shorteners', 'Mataroa']);
    expect(result.failed).toEqual([
      { connector: 'Hugo', message: 'storage unavailable' },
      { connector: 'GitHub', message: 'conflict' },
    ]);
  });
});
