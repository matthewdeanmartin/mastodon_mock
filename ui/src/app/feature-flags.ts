import { Injectable, signal } from '@angular/core';
import { BUILD_INFO } from './build-info';
import { isCanaryBuild, isTestBuild } from './build-flavor';

const STORAGE_KEY = 'mockingbird_feature_flags';
const DEV_BUILD_HASH = 'development';

export type FeatureFlagId =
  | 'pastebin'
  | 'links'
  | 'write'
  | 'unified-share'
  | 'mawkingbird-plus'
  | 'connector-mastodon'
  | 'connector-bluesky'
  | 'connector-twitter'
  | 'connector-mataroa'
  | 'connector-blogger'
  | 'connector-hugo'
  | 'connector-openrouter'
  | 'connector-raindrop'
  | 'connector-github'
  | 'connector-dropbox'
  | 'connector-link-shortener'
  | 'connector-cors-proxy'
  | 'connector-rss'
  | 'proxy-mawkingbird-plus'
  | 'proxy-allorigins'
  | 'proxy-corssh'
  | 'proxy-corsfix'
  | 'proxy-corslol';
/**
 * How far down the rollout ladder a feature has been released.
 *
 * Read as "on at this rung and below": `production` is everywhere, `canary` is
 * canary and test, `test` is test only. `off` is nowhere.
 */
export type FeatureFlagState = 'production' | 'canary' | 'test' | 'off';

/**
 * Flags are grouped only for display — a group is a heading on the settings
 * page, never a unit you can switch. An outage is per-vendor, so the switch is
 * per-vendor too.
 */
export type FeatureFlagGroup = 'features' | 'connectors' | 'proxies';

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
    id: 'write',
    label: 'Write',
    description:
      'The writing workspace at /write — drafts, editor and notes side by side, plus zen mode.',
    defaultState: 'production',
    group: 'features',
  },
  {
    id: 'unified-share',
    label: 'Unified share menu',
    // Says what turning it on changes, since this one is off by default and the
    // question a reader has is "what will this do to my posts".
    description:
      'Collapse Boost, Quote and Share into one button on every post, opening a menu instead. ' +
      'Frees a slot on an action bar that already wraps on narrow screens.',
    // `test`, not `production`: this changes the action bar on every post in the
    // app, which is the most-used surface there is. It earns its way up rather
    // than starting at the top.
    defaultState: 'test',
    group: 'features',
  },
  {
    id: 'mawkingbird-plus',
    label: 'Mawkingbird Plus',
    // Says what switching it off removes, per the convention above. Nothing
    // else in the app depends on an account, so this genuinely only hides the
    // one settings tab — signed-out users lose no functionality.
    description:
      'The Mawkingbird account tab in Settings, where you sign in to your Mawkingbird account.',
    // `test`, not `canary`: canary is production, on live billing, and this tab
    // leads to a checkout. Until there is a live Stripe price it must not be
    // reachable anywhere a real customer can press the button.
    defaultState: 'test',
    group: 'features',
  },
  {
    id: 'connector-mastodon',
    label: 'Mastodon',
    description:
      'Mastodon attached to a Bluesky-primary account: Explore, trends and tag timelines, read anonymously or signed in.',
    defaultState: 'production',
    group: 'connectors',
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
    id: 'connector-mataroa',
    label: 'Blog (Mataroa)',
    description: 'Publishing blog posts and optionally including them on your profile.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-blogger',
    label: 'Blog (Blogger)',
    description: 'Publishing posts and drafts to a Google Blogger blog.',
    defaultState: 'production',
    group: 'connectors',
  },
  {
    id: 'connector-hugo',
    label: 'Blog (Hugo)',
    description: 'Publishing posts to a Hugo site in a GitHub repository.',
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
  // ------------------------------------------------------------- proxies
  //
  // The four public CORS proxies, all defaulting to `off`.
  //
  // Not a judgement about the operators — they run free services and mostly do
  // what they say. It is that recommending them produced a bad experience often
  // enough that offering them by default was doing users a disservice. Between
  // them: AllOrigins strips custom headers (so no API key can pass) and was
  // measured at 26s for a 1s call, and returns 522s under load; cors.lol 429'd
  // on nearly every request including the first of a session; Corsfix needs the
  // deployed domain registered before it answers at all; CORS.SH needs a key you
  // must go and get. Each is a different way for a first-time setup to fail
  // while looking like the app is broken.
  //
  // What is left on by default is the Mawkingbird proxy — destination-scoped,
  // and answerable to whoever runs it — and "your own proxy", which nobody else
  // can rate-limit or shut off. Anyone who wants one of these four back can turn
  // its flag on; the entries and their honest measured copy stay in the catalog
  // for exactly that.
  {
    id: 'proxy-mawkingbird-plus',
    label: 'Mawkingbird Plus proxy',
    description:
      'Offer the supporter tier of the Mawkingbird proxy. Needs an account and a subscription; the free Mawkingbird proxy is unaffected either way.',
    // Paired with `mawkingbird-plus` above, and for the same reason: offering a
    // proxy tier nobody can buy is worse than not offering it.
    defaultState: 'test',
    group: 'proxies',
  },
  {
    id: 'proxy-allorigins',
    label: 'AllOrigins proxy',
    description:
      'Offer AllOrigins as a CORS proxy. Strips custom headers, so no API key can travel through it, and it is frequently very slow.',
    defaultState: 'off',
    group: 'proxies',
  },
  {
    id: 'proxy-corssh',
    label: 'CORS.SH proxy',
    description: 'Offer CORS.SH as a CORS proxy. Requires a free key before it will answer.',
    defaultState: 'off',
    group: 'proxies',
  },
  {
    id: 'proxy-corsfix',
    label: 'Corsfix proxy',
    description:
      'Offer Corsfix as a CORS proxy. Fast, but a deployed site must register its domain first or every request is refused.',
    defaultState: 'off',
    group: 'proxies',
  },
  {
    id: 'proxy-corslol',
    label: 'cors.lol proxy',
    description:
      'Offer cors.lol as a CORS proxy. No signup, but it rate-limits aggressively — often on the first request of a session.',
    defaultState: 'off',
    group: 'proxies',
  },
];

/**
 * The flag that governs a proxy catalog entry, or null when it has none.
 *
 * Only the third-party proxies are flagged. The Mawkingbird proxy and the
 * bring-your-own entry deliberately have no flag: the first is the default this
 * app stands behind, and the second is a URL the user typed, which is not ours
 * to switch off.
 */
export function proxyFeatureFlag(proxyId: string): FeatureFlagId | null {
  switch (proxyId) {
    case 'mawkingbird-plus':
      return 'proxy-mawkingbird-plus';
    case 'allorigins':
      return 'proxy-allorigins';
    case 'corssh':
      return 'proxy-corssh';
    case 'corsfix':
      return 'proxy-corsfix';
    case 'corslol':
      return 'proxy-corslol';
    default:
      return null;
  }
}

const VALID_STATES: readonly FeatureFlagState[] = ['production', 'canary', 'test', 'off'];

/** Flags in one group, in declaration order — for the settings page's sections. */
export function flagsInGroup(group: FeatureFlagGroup): readonly FeatureFlagDefinition[] {
  return FEATURE_FLAGS.filter((flag) => flag.group === group);
}

/**
 * Where a deployment sits on the rollout ladder.
 *
 * Ordered, and the order is the whole point: a channel runs everything enabled
 * at its own rung *and below*. `test` sees the most, production the least.
 */
const CHANNEL_RANK = { production: 0, canary: 1, test: 2 } as const;

/** Which channel this build is. */
export type DeploymentChannel = keyof typeof CHANNEL_RANK;

/**
 * The channel this build is running as.
 *
 * Note that `test` is a channel here but **canary and production are the same
 * environment** — canary is a release channel on production infrastructure,
 * against live billing. The ladder is about which features are *visible*, not
 * about which backend is in use; those are separate questions and conflating
 * them is how a feature ends up enabled somewhere it cannot work.
 */
export function deploymentChannel(baseUri: string = document.baseURI): DeploymentChannel {
  if (isTestBuild(baseUri)) {
    return 'test';
  }
  return isCanaryBuild(baseUri) ? 'canary' : 'production';
}

/**
 * Resolve a rollout state for one concrete deployment channel.
 *
 * A feature flagged `canary` is on in canary *and* test, because test is
 * further down the ladder — a feature that skipped test on its way to canary
 * would make the test deployment useless for exactly the features most worth
 * testing.
 */
export function isFeatureEnabled(state: FeatureFlagState, channel: DeploymentChannel): boolean {
  if (state === 'off') {
    return false;
  }
  return CHANNEL_RANK[channel] >= CHANNEL_RANK[state];
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
  /** Which rung of the rollout ladder this build is on. */
  readonly channel = deploymentChannel();
  readonly definitions = FEATURE_FLAGS;

  private readonly states = signal<Record<FeatureFlagId, FeatureFlagState>>(this.defaults());

  constructor() {
    this.load();
  }

  state(id: FeatureFlagId): FeatureFlagState {
    return this.states()[id];
  }

  enabled(id: FeatureFlagId): boolean {
    return isFeatureEnabled(this.states()[id], this.channel);
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
