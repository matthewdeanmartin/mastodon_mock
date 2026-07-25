import { beforeEach, describe, expect, it } from 'vitest';
import { FeatureFlags, isFeatureEnabled } from './feature-flags';

const STORAGE_KEY = 'mockingbird_feature_flags';

describe('feature flag rollout states', () => {
  it('enables production on both channels, canary only on canary, and off nowhere', () => {
    expect(isFeatureEnabled('production', false)).toBe(true);
    expect(isFeatureEnabled('production', true)).toBe(true);
    expect(isFeatureEnabled('canary', false)).toBe(false);
    expect(isFeatureEnabled('canary', true)).toBe(true);
    expect(isFeatureEnabled('off', false)).toBe(false);
    expect(isFeatureEnabled('off', true)).toBe(false);
  });
});

describe('FeatureFlags', () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEY));

  it('defaults pastebin to the production rollout', () => {
    const flags = new FeatureFlags();

    expect(flags.state('pastebin')).toBe('production');
    expect(flags.enabled('pastebin')).toBe(true);
  });

  it('retains an override for the same published hash', () => {
    const first = new FeatureFlags();
    first.setState('pastebin', 'off');

    const reloaded = new FeatureFlags();

    expect(reloaded.state('pastebin')).toBe('off');
  });

  it('resets overrides when the published hash changes', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ publishedHash: 'an-older-published-hash', states: { pastebin: 'off' } }),
    );

    const flags = new FeatureFlags();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      publishedHash?: string;
    };

    expect(flags.state('pastebin')).toBe('production');
    expect(stored.publishedHash).toBe(flags.publishedHash);
  });
});
