import { describe, expect, it } from 'vitest';
import {
  campaignTaggedUrl,
  INVITE_VARIATIONS,
  inviteIntentUrl,
  invitesFor,
  invitesPageUrl,
  JOIN_MASTODON_URL,
  mastodonRallyText,
  publicServerUrl,
  renderInvite,
} from './invite-templates';

describe('renderInvite', () => {
  it('fills available values and drops whole lines for unavailable optional values', () => {
    const text = renderInvite('Hello\nFind me: {profileUrl}\nStart: {visitUrl}\nHandle: {handle}', {
      profileUrl: '',
      handle: '',
      visitUrl: JOIN_MASTODON_URL,
    });

    expect(text).toBe(`Hello\nStart: ${JOIN_MASTODON_URL}`);
    expect(text).not.toContain('{');
  });
});

describe('invitation inventory', () => {
  it('offers exactly two sensible choices in simple mode', () => {
    expect(invitesFor(true)).toHaveLength(2);
    expect(invitesFor(true).every((invite) => invite.simple)).toBe(true);
  });

  it('keeps the touch-grass joke in advanced mode only', () => {
    expect(invitesFor(true).some((invite) => invite.id === 'touch-grass')).toBe(false);
    expect(invitesFor(false).some((invite) => invite.id === 'touch-grass')).toBe(true);
  });

  it('keeps every default direct invitation within Twitter’s limit', () => {
    for (const invite of INVITE_VARIATIONS) {
      const text = renderInvite(invite.template, {
        profileUrl: 'https://example.social/@person',
        handle: '@person@example.social',
        visitUrl: JOIN_MASTODON_URL,
      });
      expect(Array.from(text).length, invite.id).toBeLessThanOrEqual(280);
    }
  });
});

describe('share destinations', () => {
  it('opens Twitter and Bluesky composers with the supplied invitation', () => {
    expect(inviteIntentUrl('x', 'hello')).toContain('https://x.com/intent/post?text=hello');
    expect(inviteIntentUrl('bluesky', 'hello')).toContain(
      'https://bsky.app/intent/compose?text=hello',
    );
  });

  it('opens the selected Mastodon server composer', () => {
    expect(inviteIntentUrl('mastodon', 'go invite friends', 'mstdn.social')).toContain(
      'https://mstdn.social/share?text=go+invite+friends',
    );
  });

  it('uses Mastodon only for a rally invitation back to the public invite page', () => {
    const text = mastodonRallyText();
    expect(text).toContain('got friends still on Twitter');
    expect(text).toContain(invitesPageUrl());
    expect(text).not.toContain('join foobar');
  });

  it('normalizes the current API server to its public homepage', () => {
    expect(publicServerUrl('https://mstdn.social/')).toBe('https://mstdn.social');
    expect(publicServerUrl('')).toBe('https://mastodon.social');
  });
});

describe('campaignTaggedUrl', () => {
  it('adds anonymous campaign metadata without changing the destination', () => {
    const tagged = new URL(
      campaignTaggedUrl(JOIN_MASTODON_URL, { source: 'mawkingbird', variationId: 'friendly' }),
    );
    expect(`${tagged.origin}${tagged.pathname}`).toBe(JOIN_MASTODON_URL);
    expect(tagged.searchParams.get('utm_source')).toBe('mawkingbird');
    expect(tagged.searchParams.get('utm_medium')).toBe('invite');
    expect(tagged.searchParams.get('utm_campaign')).toBe('friendly');
  });
});
