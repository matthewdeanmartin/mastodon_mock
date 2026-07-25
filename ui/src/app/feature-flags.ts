import { Injectable, signal } from '@angular/core';
import { BUILD_INFO } from './build-info';
import { isCanaryBuild } from './build-flavor';

const STORAGE_KEY = 'mockingbird_feature_flags';
const DEV_BUILD_HASH = 'development';

export type FeatureFlagId = 'pastebin';
export type FeatureFlagState = 'production' | 'canary' | 'off';

export interface FeatureFlagDefinition {
  id: FeatureFlagId;
  label: string;
  description: string;
  defaultState: FeatureFlagState;
}

interface StoredFeatureFlags {
  publishedHash: string;
  states: Partial<Record<FeatureFlagId, FeatureFlagState>>;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: 'pastebin',
    label: 'Pastebin',
    description: 'Create, manage, and follow posts published through external paste services.',
    defaultState: 'production',
  },
];

const VALID_STATES: readonly FeatureFlagState[] = ['production', 'canary', 'off'];

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
