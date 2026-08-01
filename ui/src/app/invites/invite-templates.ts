/** Pure invitation copy and share-intent helpers for the public Invites page. */

/** A site whose composer can be opened with prefilled text. */
export type InviteNetwork = 'x' | 'bluesky' | 'mastodon';

/** A direct invitation intended for friends on any other social platform. */
export interface InviteVariation {
  /** Stable identity, also used as the campaign name when tracking is enabled. */
  id: string;
  title: string;
  description: string;
  /** Simple mode intentionally exposes exactly two low-friction choices. */
  simple: boolean;
  /** The post, with optional `{placeholder}` tokens. */
  template: string;
}

/** Everything a template can interpolate. An empty value removes its whole line. */
export interface InviteContext {
  profileUrl: string;
  handle: string;
  /** The selected place where the recipient can start with Mastodon. */
  visitUrl: string;
}

export const MAWKINGBIRD_URL = 'https://mawkingbird.com';
export const JOIN_MASTODON_URL = 'https://joinmastodon.org/servers';
export const INVITE_LIMITS: Record<InviteNetwork, number> = {
  x: 280,
  bluesky: 300,
  mastodon: 500,
};

/** Normalize a chosen API/home server into the public homepage we can promote. */
export function publicServerUrl(host = 'mastodon.social'): string {
  const clean = host.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'mastodon.social';
  return `https://${clean}`;
}

/** The public Invites route, suitable for putting in a Mastodon rally post. */
export function invitesPageUrl(): string {
  return `${MAWKINGBIRD_URL}/invites`;
}

/** Add campaign tags before a destination is handed to a link shortener. */
export function campaignTaggedUrl(
  url: string,
  options: { source: string; variationId: string },
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.searchParams.set('utm_source', options.source);
  parsed.searchParams.set('utm_medium', 'invite');
  parsed.searchParams.set('utm_campaign', options.variationId);
  return parsed.toString();
}

/** Fill a template, removing whole lines whose optional value is unavailable. */
export function renderInvite(template: string, context: InviteContext): string {
  const values: Record<string, string> = {
    profileUrl: context.profileUrl,
    handle: context.handle,
    visitUrl: context.visitUrl,
    mawkingbird: MAWKINGBIRD_URL,
  };
  return template
    .split('\n')
    .filter((line) => {
      const tokens = line.match(/\{(\w+)\}/g) ?? [];
      return tokens.every((token) => !!values[token.slice(1, -1)]);
    })
    .map((line) => line.replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build a normal, user-controlled web share intent. Nothing is posted automatically. */
export function inviteIntentUrl(
  network: InviteNetwork,
  text: string,
  mastodonHost = 'mastodon.social',
): string {
  const base =
    network === 'x'
      ? 'https://x.com/intent/post'
      : network === 'bluesky'
        ? 'https://bsky.app/intent/compose'
        : `${publicServerUrl(mastodonHost)}/share`;
  const url = new URL(base);
  url.searchParams.set('text', text);
  return url.toString();
}

export const INVITE_VARIATIONS: readonly InviteVariation[] = [
  {
    id: 'friendly',
    title: 'A friendly invitation',
    description: 'A warm, low-pressure invitation that works on any social platform.',
    simple: true,
    template: `Come join me on Mastodon — social media made of independent communities that can still talk to one another.

Find me here: {profileUrl}

Pick a server and get started: {visitUrl}

#Mastodon #Fediverse`,
  },
  {
    id: 'leave-twitter',
    title: 'Leave Twitter behind',
    description: 'A direct invitation for friends who are ready for somewhere else.',
    simple: true,
    template: `Still on Twitter? Upgrade your experience by leaving it behind. Come find your people on Mastodon instead.

I’m here: {profileUrl}

Start here: {visitUrl}

#JoinMastodon #Fediverse`,
  },
  {
    id: 'open-web',
    title: 'Try the open social web',
    description: 'For friends on Bluesky, Threads, Twitter, or anywhere else.',
    simple: false,
    template: `Wherever you post now, you can also be part of the open social web. Mastodon lets you choose a community and still follow people across the Fediverse.

Come say hello: {profileUrl}

See where to start: {visitUrl}

#Mastodon #OpenWeb`,
  },
  {
    id: 'touch-grass',
    title: 'Real talk: touch grass',
    description: 'The deliberately unserious option.',
    simple: false,
    template: `Hey, I’ve invited you to Mastodon, to Bluesky, and that didn’t work. I’m now inviting you to go touch grass. Log out and upgrade your experience by leaving Twitter.

If you come back online, try this: {visitUrl}`,
  },
];

export function invitesFor(simple: boolean): readonly InviteVariation[] {
  return simple ? INVITE_VARIATIONS.filter((invite) => invite.simple) : INVITE_VARIATIONS;
}

/** Mastodon shares are meta-invitations: they ask existing users to recruit elsewhere. */
export function mastodonRallyText(): string {
  return `Hey Mastodon users: got friends still on Twitter? Go save them. Pick an invitation, make it your own, and send it from wherever they still post.\n\n${invitesPageUrl()}\n\n#Mastodon #Fediverse`;
}
