import { beforeEach, describe, expect, it } from 'vitest';
import { FeatureFlags, FEATURE_FLAGS, flagsInGroup, isFeatureEnabled } from './feature-flags';
import {
  CONNECTION_CATALOG,
  CONNECTION_FLAGS,
} from './pages/settings/connections/connection-catalog';

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

  it('reports no disabled reason while a flag is enabled', () => {
    const flags = new FeatureFlags();

    expect(flags.disabledReason('connector-bluesky')).toBeNull();
  });

  it('explains a turned-off connector, and says so differently for canary-only', () => {
    const flags = new FeatureFlags();

    flags.setState('connector-twitter', 'off');
    expect(flags.disabledReason('connector-twitter')).toBe('Disabled by a feature flag.');

    // Canary-only on a production build is still off, but for a reason worth
    // distinguishing: it is coming, rather than broken.
    flags.setState('connector-twitter', 'canary');
    expect(flags.disabledReason('connector-twitter')).toContain('canary build first');
  });
});

describe('connector flags', () => {
  it('gates every catalog entry with a flag that exists', () => {
    const ids = new Set(FEATURE_FLAGS.map((flag) => flag.id));

    for (const entry of CONNECTION_CATALOG) {
      const flagId = CONNECTION_FLAGS[entry.id];
      expect(flagId, `${entry.id} has no flag`).toBeDefined();
      expect(ids.has(flagId), `${flagId} is not a declared flag`).toBe(true);
    }
  });

  it('ships every connector on production, so today nothing is withheld', () => {
    for (const flag of flagsInGroup('connectors')) {
      expect(flag.defaultState, `${flag.id} should default to production`).toBe('production');
    }
  });
});
