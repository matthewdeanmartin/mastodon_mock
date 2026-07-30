/**
 * The invitation copy, and the pure functions that turn it into a share intent.
 *
 * This file IS the inventory — to reword an invitation, edit the array below.
 * Nothing here touches the DOM, Angular, or a network, so the interesting rules
 * (placeholder substitution, line dropping, character budgets) are testable on
 * their own and the page component stays a thin shell.
 *
 * Two networks, two pitches, and the difference matters:
 *
 * - **X** invites ask people to *join Mastodon*. The reader has no fediverse
 *   account, so the call to action is "make one, and here is a client".
 * - **Bluesky** invites ask people to *come hang out with the Mastodon half of
 *   their friends*, which needs no signup at all: Mawkingbird's anonymous mode
 *   reads a public instance with no account, so the link does the whole job.
 *
 * We never use an X or Bluesky API, never ask for authorization, and never post
 * anything. Every invitation ends at a prefilled composer the user has to read,
 * possibly edit, and submit themselves.
 */

/** Which network an invitation is written for. */
export type InviteNetwork = 'x' | 'bluesky';

export interface InviteVariation {
  /** Stable identity — used as a track key and in the accessible label. */
  id: string;
  network: InviteNetwork;
  /** Short card heading, e.g. "Friendly migration". */
  title: string;
  /** The post, with `{placeholder}` tokens. See {@link renderInvite}. */
  template: string;
}

/** Everything a template can interpolate. An empty string means "unknown". */
export interface InviteContext {
  /** Canonical profile URL of the signed-in account, e.g. `https://host/@me`. */
  profileUrl: string;
  /** The same account as `@user@host`. */
  handle: string;
  /** Anonymous-entry link that opens Mawkingbird on a specific instance. */
  visitUrl: string;
}

/** The product's public home. Hardcoded on purpose — see {@link anonymousEntryUrl}. */
export const MAWKINGBIRD_URL = 'https://mawkingbird.com';

/**
 * X and Bluesky composer limits, for the local estimate shown on each card.
 *
 * An estimate is all it can be: both networks count links as a fixed weight
 * rather than by length (and X's is neither published nor stable), so the
 * composer is always the final authority. We warn rather than block.
 */
export const INVITE_LIMITS: Record<InviteNetwork, number> = { x: 280, bluesky: 300 };

/**
 * Where "try it without signing up" points.
 *
 * Always built against {@link MAWKINGBIRD_URL} rather than the running
 * deployment's own base URL, because this string is going into a post someone
 * else will read: a link to `localhost:4200` or to a fork's GitHub Pages URL is
 * worse than useless in a stranger's timeline.
 *
 * `host` is the instance the visitor lands on, matching the share link in the
 * right rail (`/anonymous?<host>`). It defaults to mastodon.social, which is
 * the right guess when we have no signed-in account to read a home server from.
 */
export function anonymousEntryUrl(host = 'mastodon.social'): string {
  const clean = host.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'mastodon.social';
  return `${MAWKINGBIRD_URL}/anonymous?${encodeURIComponent(clean)}`;
}

/**
 * Fill a template in, dropping whole lines whose data we do not have.
 *
 * A missing profile URL must never leave `{profileUrl}` — or a bare "Find me
 * at" — visible in the composer, and patching the sentence back into shape is
 * hopeless in general. So the unit of removal is the line: any line mentioning
 * a token that resolves to empty is deleted outright, which is why every
 * template below keeps its personal sentence on a line of its own.
 *
 * Blank runs left behind are collapsed back to a single blank line so the post
 * does not open with a hole in the middle of it.
 */
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

/**
 * The prefilled-composer URL for a rendered invitation.
 *
 * The whole post goes in `text`, and nothing else does. Both networks accept a
 * separate `url` (and X a separate `hashtags`), but every link and tag is
 * already in the body — supplying them twice is how you end up with a duplicated
 * URL in the composer, and it would make the preview on the card a lie.
 */
export function inviteIntentUrl(network: InviteNetwork, text: string): string {
  const url = new URL(
    network === 'x' ? 'https://x.com/intent/post' : 'https://bsky.app/intent/compose',
  );
  url.searchParams.set('text', text);
  return url.toString();
}

/**
 * Ten ways to ask your X followers to come over, in rough order of how safe
 * they are to post: plainest first, novelty last.
 *
 * The hashtag sets are deliberately uneven. Ten posts carrying an identical
 * block of six tags reads as a campaign — which is the one thing an invitation
 * must not look like — so each carries two or three, chosen for that post.
 */
const X_INVITES: readonly InviteVariation[] = [
  {
    id: 'x-straightforward',
    network: 'x',
    title: 'Straightforward',
    template: `I’m on Mastodon! Come join me for social media built around communities instead of one central platform.

Find me here: {profileUrl}

Try it with ${MAWKINGBIRD_URL}

#Mastodon #Fediverse`,
  },
  {
    id: 'x-try-first',
    network: 'x',
    title: 'Try before committing',
    template: `Curious about Mastodon but haven’t tried it yet? Mawkingbird makes it easy to explore and use Mastodon from the web.

${MAWKINGBIRD_URL}

#Mastodon #Fediverse #SocialMedia`,
  },
  {
    id: 'x-follow-me',
    network: 'x',
    title: 'Follow me',
    template: `I’d love to see more of my X friends on Mastodon. It takes a couple of minutes to try.

Follow me at {profileUrl}

Start here: ${MAWKINGBIRD_URL}

#Mastodon #JoinMastodon`,
  },
  {
    id: 'x-no-algorithm',
    network: 'x',
    title: 'No algorithm',
    template: `Want a social feed you control instead of one chosen entirely by an algorithm? Give Mastodon a try.

Start with ${MAWKINGBIRD_URL}

#Mastodon #Fediverse #OpenSocial`,
  },
  {
    id: 'x-community',
    network: 'x',
    title: 'Lots of small communities',
    template: `Mastodon is made of independent communities that can still talk to one another. It’s a different and surprisingly human way to use social media.

Come try it: ${MAWKINGBIRD_URL}

#Mastodon #Fediverse`,
  },
  {
    id: 'x-friendly-migration',
    network: 'x',
    title: 'Friendly migration',
    template: `You don’t have to quit X to try Mastodon. Make an account, follow a few people, and see whether you like it.

${MAWKINGBIRD_URL}

#TryMastodon #Fediverse`,
  },
  {
    id: 'x-open-web',
    network: 'x',
    title: 'The open web',
    template: `I’m spending more time on the open social web. Mastodon lets people pick their own community and still follow people everywhere else.

Join me: {profileUrl}

Or just start here: ${MAWKINGBIRD_URL}

#Mastodon #OpenWeb`,
  },
  {
    id: 'x-low-pressure',
    network: 'x',
    title: 'Low pressure',
    template: `Friendly invitation: come say hello to me on Mastodon sometime.

My profile: {profileUrl}

You can try Mastodon through ${MAWKINGBIRD_URL}

#Mastodon #Fediverse`,
  },
  {
    id: 'x-mawkingbird',
    network: 'x',
    title: 'About Mawkingbird',
    template: `Want to see what Mastodon is like? Try Mawkingbird, a web client for exploring and using the Fediverse.

${MAWKINGBIRD_URL}

#Mawkingbird #Mastodon #Fediverse`,
  },
  {
    id: 'x-bring-friends',
    network: 'x',
    title: 'Bring your friends',
    template: `Social networks get better when your friends are there. I’m inviting mine to join me on Mastodon.

Find me at {handle}
Get started at ${MAWKINGBIRD_URL}

#JoinMastodon #Fediverse`,
  },
];

/**
 * The Bluesky set, which is a different ask.
 *
 * A Bluesky reader is already sold on decentralised social media and does not
 * need a pitch for it — what they are missing is the *other* half of their
 * friends, the ones who went to Mastodon. And they can have that today without
 * signing up for anything, because `{visitUrl}` opens Mawkingbird in anonymous
 * mode against a real instance. So these lead with the link and the "no account
 * needed" fact, and only then mention following me.
 *
 * `{visitUrl}` is the load-bearing token here: a Bluesky invitation whose line
 * got dropped for want of it has lost its point, so the token always resolves
 * (it falls back to mastodon.social).
 */
const BLUESKY_INVITES: readonly InviteVariation[] = [
  {
    id: 'bsky-both-at-once',
    network: 'bluesky',
    title: 'Both at once',
    template: `Hey — some of your friends are over on Mastodon. You can hang out with both crowds in one timeline with Mawkingbird, and you don’t even have to sign up for an account.

{visitUrl}

#Mastodon #Fediverse`,
  },
  {
    id: 'bsky-no-signup',
    network: 'bluesky',
    title: 'No signup needed',
    template: `You can read Mastodon right now without making an account anywhere. Open this, look around, and leave if it’s not for you:

{visitUrl}

#Fediverse #Mastodon`,
  },
  {
    id: 'bsky-one-timeline',
    network: 'bluesky',
    title: 'One timeline',
    template: `I got tired of checking two apps, so now I read Bluesky and Mastodon in the same timeline. Mawkingbird does both, and Mastodon works without an account:

{visitUrl}

#Bluesky #Mastodon`,
  },
  {
    id: 'bsky-your-people',
    network: 'bluesky',
    title: 'Your people are there',
    template: `A surprising number of the people you used to follow are posting on Mastodon these days. No account needed to go see:

{visitUrl}

You’ll find me at {handle}

#Mastodon #Fediverse`,
  },
  {
    id: 'bsky-window-shop',
    network: 'bluesky',
    title: 'Just window shopping',
    template: `Not asking you to switch to anything. Mawkingbird will show you Mastodon with no account, no email, no signup — just have a look and see whether your people are there.

{visitUrl}

#Fediverse #Mastodon`,
  },
  {
    id: 'bsky-say-hello',
    network: 'bluesky',
    title: 'Come say hello',
    template: `Come say hello to me on the Mastodon side sometime — {profileUrl}

You can read it without signing up for anything: {visitUrl}

#Mastodon #Fediverse`,
  },
  {
    id: 'bsky-same-web',
    network: 'bluesky',
    title: 'Same open web',
    template: `Bluesky and Mastodon are both the open social web, and there’s no reason to pick just one. Mawkingbird reads both, and the Mastodon half needs no account at all:

{visitUrl}

#Bluesky #Mastodon #OpenWeb`,
  },
  {
    id: 'bsky-guest-pass',
    network: 'bluesky',
    title: 'Guest pass',
    template: `Consider this a guest pass to Mastodon: no account, no signup, just a public timeline you can read today. If you like it, then make an account.

{visitUrl}

#Mastodon #TryMastodon`,
  },
];

/** Every invitation, both networks, in display order. */
export const INVITE_VARIATIONS: readonly InviteVariation[] = [...X_INVITES, ...BLUESKY_INVITES];

/** The invitations written for one network. */
export function invitesFor(network: InviteNetwork): readonly InviteVariation[] {
  return INVITE_VARIATIONS.filter((invite) => invite.network === network);
}
