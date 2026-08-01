import { describe, expect, it } from 'vitest';
import {
  anonymousEntryUrl,
  campaignTaggedUrl,
  INVITE_LIMITS,
  InviteContext,
  inviteIntentUrl,
  invitesFor,
  INVITE_VARIATIONS,
  MAWKINGBIRD_URL,
  renderInvite,
} from './invite-templates';

const FULL: InviteContext = {
  profileUrl: 'https://example.social/@matt',
  handle: '@matt@example.social',
  visitUrl: `${MAWKINGBIRD_URL}/anonymous?example.social`,
};

const ANONYMOUS: InviteContext = {
  profileUrl: '',
  handle: '',
  visitUrl: `${MAWKINGBIRD_URL}/anonymous?mastodon.social`,
};

describe('renderInvite', () => {
  it('substitutes every known token', () => {
    const text = renderInvite(
      'me: {profileUrl}\nas {handle}\nvisit {visitUrl}\nvia {mawkingbird}',
      {
        ...FULL,
      },
    );
    expect(text).toBe(
      `me: https://example.social/@matt\nas @matt@example.social\n` +
        `visit ${MAWKINGBIRD_URL}/anonymous?example.social\nvia ${MAWKINGBIRD_URL}`,
    );
  });

  it('drops the whole line when a token has no value, leaving no placeholder', () => {
    const text = renderInvite('Come over.\n\nFind me at {profileUrl}\n\nTry {visitUrl}', ANONYMOUS);
    expect(text).not.toContain('{');
    expect(text).not.toContain('Find me at');
    expect(text).toBe(`Come over.\n\nTry ${MAWKINGBIRD_URL}/anonymous?mastodon.social`);
  });

  it('collapses the blank run a dropped line leaves behind', () => {
    const text = renderInvite('One.\n\n{handle}\n\nTwo.', ANONYMOUS);
    expect(text).toBe('One.\n\nTwo.');
  });

  it('trims leading and trailing whitespace', () => {
    expect(renderInvite('\n\n  Hello.  \n\n', FULL)).toBe('Hello.');
  });

  it('leaves text alone when it has no tokens', () => {
    expect(renderInvite('Nothing to fill in.', ANONYMOUS)).toBe('Nothing to fill in.');
  });
});

describe('anonymousEntryUrl', () => {
  it('builds a mawkingbird.com link, not one to the running deployment', () => {
    expect(anonymousEntryUrl('elekk.xyz')).toBe(`${MAWKINGBIRD_URL}/anonymous?elekk.xyz`);
  });

  it('strips a scheme and trailing slashes off the host', () => {
    expect(anonymousEntryUrl('https://elekk.xyz/')).toBe(`${MAWKINGBIRD_URL}/anonymous?elekk.xyz`);
  });

  it('falls back to mastodon.social when the host is unknown', () => {
    expect(anonymousEntryUrl('')).toBe(`${MAWKINGBIRD_URL}/anonymous?mastodon.social`);
    expect(anonymousEntryUrl()).toBe(`${MAWKINGBIRD_URL}/anonymous?mastodon.social`);
  });
});

describe('inviteIntentUrl', () => {
  it('uses the tweet intent with the whole post in text', () => {
    const url = new URL(inviteIntentUrl('x', 'hello #Mastodon'));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe('hello #Mastodon');
  });

  it('uses the Bluesky compose intent', () => {
    const url = new URL(inviteIntentUrl('bluesky', 'hello'));
    expect(url.origin + url.pathname).toBe('https://bsky.app/intent/compose');
    expect(url.searchParams.get('text')).toBe('hello');
  });

  it('passes no url or hashtags parameter — they are already in the body', () => {
    const url = new URL(inviteIntentUrl('x', `see ${MAWKINGBIRD_URL} #Fediverse`));
    expect([...url.searchParams.keys()]).toEqual(['text']);
  });
});

describe('the invitation inventory', () => {
  it('offers ten Twitter variations and at least six for Bluesky', () => {
    expect(invitesFor('x')).toHaveLength(10);
    expect(invitesFor('bluesky').length).toBeGreaterThanOrEqual(6);
  });

  it('gives every variation a unique id and title within its network', () => {
    const ids = INVITE_VARIATIONS.map((invite) => invite.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const network of ['x', 'bluesky'] as const) {
      const titles = invitesFor(network).map((invite) => invite.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it('tags every variation with two or three Mastodon/Fediverse hashtags', () => {
    for (const invite of INVITE_VARIATIONS) {
      const tags = invite.template.match(/#\w+/g) ?? [];
      expect(tags.length, invite.id).toBeGreaterThanOrEqual(2);
      expect(tags.length, invite.id).toBeLessThanOrEqual(3);
      expect(tags.join(' '), invite.id).toMatch(/#(Mastodon|Fediverse|JoinMastodon|TryMastodon)/);
    }
  });

  it('does not put the same hashtag block on every variation', () => {
    const blocks = new Set(
      INVITE_VARIATIONS.map((invite) => (invite.template.match(/#\w+/g) ?? []).join(' ')),
    );
    expect(blocks.size).toBeGreaterThan(4);
  });

  it('fits the composer limit rendered both with and without a profile', () => {
    for (const invite of INVITE_VARIATIONS) {
      const limit = INVITE_LIMITS[invite.network];
      for (const context of [FULL, ANONYMOUS]) {
        const text = renderInvite(invite.template, context);
        expect(Array.from(text).length, `${invite.id} / ${limit}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('leaves no placeholder anywhere when nothing personal is known', () => {
    for (const invite of INVITE_VARIATIONS) {
      expect(renderInvite(invite.template, ANONYMOUS), invite.id).not.toContain('{');
    }
  });

  it('never strands a link on a line that gets dropped with the profile', () => {
    // The failure this guards against: "Follow me at {profileUrl}, or start at
    // https://mawkingbird.com" reads fine — and then a signed-out user drops the
    // whole line and gets an invitation with nowhere to go. Anything that has to
    // survive belongs on its own line.
    for (const invite of INVITE_VARIATIONS) {
      for (const line of invite.template.split('\n')) {
        if (!/\{(profileUrl|handle)\}/.test(line)) {
          continue;
        }
        expect(line, invite.id).not.toContain(MAWKINGBIRD_URL);
        expect(line, invite.id).not.toContain('{visitUrl}');
        expect(line, invite.id).not.toContain('#');
      }
    }
  });

  it('still gives every Twitter invitation somewhere to go with no profile to show', () => {
    for (const invite of invitesFor('x')) {
      expect(renderInvite(invite.template, ANONYMOUS), invite.id).toContain(MAWKINGBIRD_URL);
    }
  });

  it('still says something useful to a Bluesky reader with no Mastodon account', () => {
    for (const invite of invitesFor('bluesky')) {
      const text = renderInvite(invite.template, ANONYMOUS);
      // The visit link is the whole point of the Bluesky pitch, so it must
      // survive the case where we know nothing about the sender.
      expect(text, invite.id).toContain(`${MAWKINGBIRD_URL}/anonymous?`);
    }
  });

  it('never leaks anything but a public profile and the visit link', () => {
    for (const invite of INVITE_VARIATIONS) {
      const tokens = invite.template.match(/\{(\w+)\}/g) ?? [];
      for (const token of tokens) {
        expect(['{profileUrl}', '{handle}', '{visitUrl}', '{mawkingbird}'], invite.id).toContain(
          token,
        );
      }
    }
  });
});

describe('campaignTaggedUrl', () => {
  const base = `${MAWKINGBIRD_URL}/anonymous?example.social`;

  it('adds the three UTM parameters without disturbing the existing query', () => {
    const tagged = new URL(campaignTaggedUrl(base, { network: 'x', variationId: 'friendly' }));

    expect(tagged.searchParams.get('utm_source')).toBe('x');
    expect(tagged.searchParams.get('utm_medium')).toBe('invite');
    expect(tagged.searchParams.get('utm_campaign')).toBe('friendly');
    // The instance host is carried as a bare query key; tagging must not eat it.
    expect(tagged.searchParams.has('example.social')).toBe(true);
  });

  it('names the invitation wording, never the reader', () => {
    const tagged = campaignTaggedUrl(base, { network: 'bluesky', variationId: 'no-signup' });

    // The only question these tags can answer is "which wording worked".
    expect(tagged).toContain('utm_campaign=no-signup');
    expect(tagged).not.toMatch(/user|account|profile|id=/i);
  });

  it('replaces rather than duplicates tags when applied twice', () => {
    const once = campaignTaggedUrl(base, { network: 'x', variationId: 'a' });
    const twice = campaignTaggedUrl(once, { network: 'bluesky', variationId: 'b' });

    const params = new URL(twice).searchParams;
    expect(params.getAll('utm_campaign')).toEqual(['b']);
    expect(params.get('utm_source')).toBe('bluesky');
  });

  it('returns an unparseable URL untouched rather than mangling it', () => {
    // The invitation still goes out; it just goes out untagged.
    expect(campaignTaggedUrl('not a url', { network: 'x', variationId: 'a' })).toBe('not a url');
  });
});
