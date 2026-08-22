import { FeatureFlagId } from './feature-flags';
import { PlusFeature } from './providers/account/plus-features';

/**
 * What a Mawkingbird Plus subscription actually buys, as data.
 *
 * ## Why this exists
 *
 * The Plus page used to describe the subscription in two hand-written
 * paragraphs, and both of them were wrong. They said Plus was "patronage, not a
 * feature unlock" and that "the app, the proxy, and everything in it work
 * exactly the same whether you pay or not" — while the profile service was
 * answering 402 to unsubscribed accounts writing lists, feeds, trust and
 * settings sync, and the same page rendered a read-only banner saying so a few
 * hundred pixels further down. Prose cannot be kept honest by review; it drifts
 * the moment a gate is added anywhere else in the app.
 *
 * So the page renders this table instead. Adding a gate without adding a row
 * here is still possible, but the rows that exist can no longer contradict the
 * app, and the rate limits are stated once rather than retyped per screen.
 *
 * ## What links to what
 *
 * - `feature` ties a row to the {@link PlusFeature} the account can switch on,
 *   so a row cannot describe a capability the settings page has no toggle for.
 * - `flag` ties a row to the {@link FeatureFlagId} that can remove it from the
 *   build entirely. A row whose flag is off must not be advertised — selling
 *   something the running build cannot do is the same class of lie the prose
 *   was telling.
 */

/**
 * Requests per minute the shared proxy allows, by tier.
 *
 * Named here and imported by the proxy catalog rather than typed into each
 * description, because these two numbers appeared in five places and the copy
 * that quoted them was the copy that went stale.
 */
export const PROXY_RATE_FREE_PER_MINUTE = 60;
export const PROXY_RATE_PLUS_PER_MINUTE = 300;

/** The subscription price, in whole US dollars per year. */
export const PLUS_PRICE_USD_PER_YEAR = 30;

export interface PlusBenefit {
  /** Stable id, for tests and for tracking a row across copy edits. */
  id: string;
  /** Row heading. A capability, not a slogan. */
  label: string;
  /** What a free account gets. Written to be true, not to be discouraging. */
  free: string;
  /** What a subscription gets. */
  plus: string;
  /**
   * The account-level switch this row corresponds to, when there is one.
   *
   * Absent for the proxy rate limit, which is not a feature you turn on — it is
   * the tier the proxy applies to whatever you were doing anyway.
   */
  feature?: PlusFeature;
  /** The flag that can remove this capability from the build. */
  flag?: FeatureFlagId;
}

/**
 * The rows, in the order the page shows them.
 *
 * The proxy limit leads because it is the one benefit that applies without the
 * subscriber changing anything. Storage rows follow, and each one names what
 * stays free — a client-side list is not a degraded server list, it is a
 * different place to keep a list, and the page says so.
 */
export const PLUS_BENEFITS: readonly PlusBenefit[] = [
  {
    id: 'proxy-rate',
    label: 'CORS proxy rate limit',
    free: `${PROXY_RATE_FREE_PER_MINUTE} requests a minute, counted per address`,
    plus: `${PROXY_RATE_PLUS_PER_MINUTE} requests a minute, counted per account`,
    flag: 'proxy-mawkingbird-plus',
  },
  {
    id: 'article-reader',
    label: 'Article reader expansions',
    free: '2 fetched articles each day; cached articles remain free to reopen',
    plus: 'Unlimited article expansions',
  },
  {
    id: 'lists-sync',
    label: 'Lists on your account',
    free: 'Unlimited lists, kept in this browser',
    plus: 'Lists stored on your account, so they follow you to your other browsers',
    feature: 'listsSync',
  },
  {
    id: 'feeds-sync',
    label: 'Feeds on your account',
    free: 'Unlimited feeds, kept in this browser',
    plus: 'Feeds stored on your account and shared across your browsers',
    feature: 'feedsSync',
  },
  {
    id: 'trust-sync',
    label: 'Trust list on your account',
    free: 'Your trust list, kept in this browser',
    plus: 'Trust list stored on your account and shared across your browsers',
    feature: 'trustSync',
  },
  {
    id: 'settings-sync',
    label: 'Settings sync',
    free: 'Settings kept in this browser; export and import by file at any time',
    plus: 'Settings synced through your account between browsers',
  },
];

/**
 * The rows worth showing in this build.
 *
 * A row with no flag is always shown. A row with one is shown only when that
 * flag is on, so a build without the Plus proxy does not advertise its rate
 * limit.
 */
export function visiblePlusBenefits(isFlagOn: (flag: FeatureFlagId) => boolean): PlusBenefit[] {
  return PLUS_BENEFITS.filter((benefit) => !benefit.flag || isFlagOn(benefit.flag));
}
