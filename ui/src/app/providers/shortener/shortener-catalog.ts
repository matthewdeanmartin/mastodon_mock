import { ShortenerId } from './shortener-provider';

/**
 * The catalog of URL shorteners, as inert data.
 *
 * Same discipline as `cors-proxy-catalog.ts` and `connection-catalog.ts`: enough
 * to choose a service and to be honest about what it costs, nothing about how
 * the choice is stored or used. Adding a fourth provider should be one entry
 * here, one adapter, and one line in the registry.
 *
 * ## Why every entry carries a privacy policy link
 *
 * Because of what happens when an API key has to travel through a CORS proxy.
 * The user is asked to accept a specific, concrete risk — a third party will see
 * a key that can create and delete links in their account — and that is not a
 * question anybody can answer without knowing *who* the third party is. The
 * consent dialog names the proxy operator and links these pages so the decision
 * is an informed one rather than a reflex click. The same fields serve the
 * connector page, where knowing what you are signing up for is just as useful.
 */

/** How a provider expects its key on the wire. */
export interface ShortenerAuth {
  /** The header name. */
  header: string;
  /**
   * Text placed before the key, if any.
   *
   * Short.io is the reason this is a field rather than an assumption: it wants
   * the raw secret key in `Authorization` with no `Bearer` prefix, which every
   * HTTP client in the world will try to add for you.
   */
  prefix: string;
}

export interface ShortenerCatalogEntry {
  id: ShortenerId;
  /** Display name, as the service spells it. */
  label: string;
  emoji: string;
  /** One sentence: what this service is, for someone who has never used it. */
  pitch: string;
  auth: ShortenerAuth;
  /** Where the user gets a key. Deep-linked, because "go find it" is hostile. */
  keyUrl: string;
  /** What the key is called on the provider's own site, so the copy matches. */
  keyLabel: string;
  /** The service's front page. */
  homepage: string;
  /** The privacy policy, for the credential-consent dialog. */
  privacyUrl: string;
  /** What the free tier actually gives you. Shown as-is, no editorialising. */
  freeTier: string;
  /**
   * Whether a custom short domain is required for the API to work at all.
   *
   * Short.io's create endpoint needs a domain: there is no shared default one,
   * so a key alone is not a working configuration. Dub and T.LY both hand you a
   * default domain, and the field is optional there.
   */
  domainRequired: boolean;
  /** Copy for the domain field, which means something different per provider. */
  domainHint: string;
}

/**
 * Every provider, in the order they appear.
 *
 * Ordered as the spec recommends implementing them, which is also the order of
 * how conventional their API is: Dub is ordinary REST, Short.io is REST with
 * quirks, T.LY identifies links by their full short URL and takes a body on
 * DELETE. A new user picking the first one gets the fewest surprises.
 */
export const SHORTENER_CATALOG: readonly ShortenerCatalogEntry[] = [
  {
    id: 'dub',
    label: 'Dub',
    emoji: '🔗',
    pitch: 'An open-source link platform with analytics. The most conventional API of the three.',
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    keyUrl: 'https://app.dub.co/settings/tokens',
    keyLabel: 'API key',
    homepage: 'https://dub.co/',
    privacyUrl: 'https://dub.co/privacy',
    freeTier: '25 links a month on the free workspace, with a dub.sh short domain.',
    domainRequired: false,
    domainHint: 'Optional. A custom domain in your Dub workspace; leave blank for dub.sh.',
  },
  {
    id: 'shortio',
    label: 'Short.io',
    emoji: '✂️',
    pitch: 'Branded short links on your own domain, with a long-standing API.',
    auth: { header: 'Authorization', prefix: '' },
    keyUrl: 'https://app.short.io/settings/integrations/api-key',
    keyLabel: 'secret API key',
    homepage: 'https://short.io/',
    privacyUrl: 'https://short.io/privacy-policy/',
    freeTier: '1,000 links a month, but you must bring your own domain.',
    // No shared default domain exists: /links rejects a create without one.
    domainRequired: true,
    domainHint: 'Required. The short domain from your Short.io account, e.g. go.example.com.',
  },
  {
    id: 'tly',
    label: 'T.LY',
    emoji: '⚡',
    pitch: 'A simple hosted shortener with tags, QR codes and statistics.',
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    keyUrl: 'https://t.ly/settings#/api',
    keyLabel: 'API token',
    homepage: 'https://t.ly/',
    privacyUrl: 'https://t.ly/privacy',
    freeTier: '10 links a month on the free plan, on the t.ly domain.',
    domainRequired: false,
    domainHint: 'Optional, and only on paid plans. Leave blank for t.ly.',
  },
];

export function shortenerEntry(
  id: ShortenerId | null | undefined,
): ShortenerCatalogEntry | undefined {
  return SHORTENER_CATALOG.find((entry) => entry.id === id);
}

/**
 * The API hosts each provider talks to.
 *
 * Exported because `cors-proxy.ts` needs them in its credential-host blocklist:
 * these are now hosts this app holds a key for, so the ordinary proxy path must
 * refuse them exactly as it refuses OpenRouter and GitHub. Only the explicit,
 * consented path may route them.
 */
export const SHORTENER_API_HOSTS: readonly string[] = ['api.dub.co', 'api.short.io', 'api.t.ly'];
