import { Injectable, signal } from '@angular/core';
import { BUILD_INFO } from './build-info';
import { isCanaryBuild } from './build-flavor';

const STORAGE_KEY = 'mockingbird_feature_flags';
const DEV_BUILD_HASH = 'development';

export type FeatureFlagId =
  | 'pastebin'
  | 'links'
  | 'connector-bluesky'
  | 'connector-twitter'
  | 'connector-openrouter'
  | 'connector-raindrop'
  | 'connector-github'
  | 'connector-dropbox'
  | 'connector-link-shortener'
  | 'connector-cors-proxy'
  | 'connector-rss';
export type FeatureFlagState = 'production' | 'canary' | 'off';

/**
 * Flags are grouped only for display — a group is a heading on the settings
 * page, never a unit you can switch. An outage is per-vendor, so the switch is
 * per-vendor too.
 */
export type FeatureFlagGroup = 'features' | 'connectors';

export interface FeatureFlagDefinition {
  id: FeatureFlagId;
  label: string;
  description: string;
  defaultState: FeatureFlagState;
  group: FeatureFlagGroup;
}

interface StoredFeatureFlags {
  publishedHash: string;
  states: Partial<Record<FeatureFlagId, FeatureFlagState>>;
}

/**
 * A connector flag's description says what stops working, not what the service
 * is — the catalog already sells the service, and someone reading this screen
 * is deciding whether turning it off will cost them something.
 */
export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: 'pastebin',
    label: 'Pastebin',
    description: 'Create, manage, and follow posts published through external paste services.',
    defaultState: 'production',
    group: 'features',
  },
  {
    id: 'links',
    label: 'Links',
    description:
      'Shorten URLs through Dub, Short.io or T.LY, and manage the links you have created.',
    defaultState: 'production',
    group: 'features',
  },
  {
    id: 'connector-bluesky',
    label: 'Bluesky',
    description: 'Bluesky posts in your timeline, replies and likes, and Bluesky DMs in Chat.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-twitter',
    label: 'Twitter',
    description: 'Following and reading public Twitter accounts through a scraper service.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-openrouter',
    label: 'OpenRouter',
    description: 'AI search queries, hashtag suggestions and translation for read-only providers.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-raindrop',
    label: 'Raindrop.io',
    description: 'Saving posts and their links to a Raindrop.io collection.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-github',
    label: 'GitHub',
    description: 'Finding the people you follow on GitHub, and reading unread notifications.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-dropbox',
    label: 'Dropbox',
    description: 'Browsing an app-specific Dropbox folder.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-link-shortener',
    label: 'Link shortener',
    description: 'Shortening URLs as you write, and the list of links you have made.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-cors-proxy',
    label: 'CORS proxy',
    description:
      'Relaying requests for sites that refuse browsers. Turning this off also stops the connectors that depend on it.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-rss',
    label: 'RSS feeds',
    description: 'Subscribing to RSS and Atom feeds, and merging them into your home timeline.',
    defaultState: 'production',
    group: 'connectors',
  },
];

const VALID_STATES: readonly FeatureFlagState[] = ['production', 'canary', 'off'];

/** Flags in one group, in declaration order — for the settings page's sections. */
export function flagsInGroup(group: FeatureFlagGroup): readonly FeatureFlagDefinition[] {
  return FEATURE_FLAGS.filter((flag) => flag.group === group);
}

/** Resolve a rollout state for one concrete deployment channel. */
export function isFeatureEnabled(state: FeatureFlagState, isCanary: boolean): boolean {
  return state === 'production' || (state === 'canary' && isCanary);
}

/**
 * Browser-local rollout overrides for experimental UI features.
 *
 * Overrides are intentionally tied to the commit SHA embedded in the published
 * build. A different deployment starts from the defaults declared above rather
 * than carrying an override forward into code it was not chosen for.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlags {
  readonly publishedHash = BUILD_INFO.commit ?? DEV_BUILD_HASH;
  readonly isCanary = isCanaryBuild();
  readonly definitions = FEATURE_FLAGS;

  private readonly states = signal<Record<FeatureFlagId, FeatureFlagState>>(this.defaults());

  constructor() {
    this.load();
  }

  state(id: FeatureFlagId): FeatureFlagState {
    return this.states()[id];
  }

  enabled(id: FeatureFlagId): boolean {
    return isFeatureEnabled(this.states()[id], this.isCanary);
  }

  /**
   * Why a flagged-off surface is greyed out, or null when it is on.
   *
   * Disabled connectors stay visible rather than disappearing: a connector that
   * silently vanishes is a support question, and the flag is browser-local, so
   * the person looking at the grey card is exactly the person who can turn it
   * back on. The settings page linked from the card is where they do that.
   */
  disabledReason(id: FeatureFlagId): string | null {
    if (this.enabled(id)) {
      return null;
    }
    return this.state(id) === 'canary'
      ? 'Disabled by a feature flag — it is being tried on the canary build first.'
      : 'Disabled by a feature flag.';
  }

  setState(id: FeatureFlagId, state: FeatureFlagState): void {
    if (!VALID_STATES.includes(state)) {
      return;
    }
    this.states.update((states) => ({ ...states, [id]: state }));
    this.persist();
  }

  private defaults(): Record<FeatureFlagId, FeatureFlagState> {
    return Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag.id, flag.defaultState])) as Record<
      FeatureFlagId,
      FeatureFlagState
    >;
  }

  private load(): void {
    try {
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null',
      ) as StoredFeatureFlags | null;
      if (stored?.publishedHash === this.publishedHash && stored.states) {
        const states = this.defaults();
        for (const flag of FEATURE_FLAGS) {
          const state = stored.states[flag.id];
          if (state && VALID_STATES.includes(state)) {
            states[flag.id] = state;
          }
        }
        this.states.set(states);
        return;
      }
    } catch {
      // Corrupt or unavailable storage starts from this build's defaults.
    }
    this.persist();
  }

  private persist(): void {
    try {
      const stored: StoredFeatureFlags = {
        publishedHash: this.publishedHash,
        states: this.states(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Feature flags still work for this tab when localStorage is unavailable.
    }
  }
}
