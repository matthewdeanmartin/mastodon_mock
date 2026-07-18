import { describe, expect, it } from 'vitest';
import { Status } from './models';
import { HEATED_THRESHOLD, isHeated, rageScore, stripHtml } from './sentiment';

function makeStatus(content: string, overrides: Partial<Status> = {}): Status {
  return {
    id: '1',
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: 'a', username: 'a', acct: 'a', display_name: 'A' } as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
    ...overrides,
  };
}

describe('stripHtml', () => {
  it('drops tags, decodes entities, and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <a href="x">world</a></p><p>&amp; more</p>')).toBe(
      'Hello world & more',
    );
  });
});

describe('rageScore', () => {
  it('scores neutral text as zero', () => {
    expect(rageScore('What a lovely afternoon for birdwatching.')).toBe(0);
  });

  it('scores hostile keywords', () => {
    expect(rageScore('These corrupt liars are pathetic')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
  });

  it('counts a repeated word only once', () => {
    expect(rageScore('trash trash trash')).toBe(rageScore('trash'));
  });

  it('treats a whole-word profanity hit as heated', () => {
    expect(rageScore('This release is dogshit.')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
    expect(rageScore('This is shit.')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
  });

  it('does not match profanity inside an otherwise harmless word', () => {
    expect(rageScore('I made a shiitake mushroom risotto.')).toBe(0);
    expect(rageScore('Press the button to continue.')).toBe(0);
    expect(rageScore('Classic assessment of the class.')).toBe(0);
  });

  it('never treats one- or two-letter words as profanity', () => {
    expect(rageScore('As is, it works as well as it can.')).toBe(0);
    expect(rageScore('a ok um hi')).toBe(0);
  });

  it('does not flag ordinary words, proper nouns, or clinical terms from the list', () => {
    expect(rageScore('Oh my god, the pawn sacrifice was bloody brilliant.')).toBe(0);
    expect(rageScore('Sex education and testicle self-exams save lives.')).toBe(0);
    expect(rageScore('Turned the knob, fixed the flange, screwing it back on.')).toBe(0);
    expect(rageScore('Tony Hoare and Brian Cox on stage together.')).toBe(0);
  });

  it('recognizes profanity with vowels replaced by asterisks', () => {
    expect(rageScore('This is f*cking broken.')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
    expect(rageScore('What a sh*t show.')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
  });

  it('treats strongly negative emoji as heated', () => {
    expect(rageScore('What a day 🤬')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
    expect(rageScore('That is disgusting 🤮')).toBeGreaterThanOrEqual(HEATED_THRESHOLD);
  });

  it('matches two-word phrases', () => {
    expect(rageScore('so sick of this, honestly fed up')).toBeGreaterThan(0);
  });

  it('adds shouting and exclamation cues', () => {
    const calm = rageScore('this is terrible');
    const shouting = rageScore('THIS WHOLE THING IS TERRIBLE!!!');
    expect(shouting).toBeGreaterThan(calm);
  });

  it('does not flag mild enthusiasm', () => {
    expect(rageScore('Great show tonight! Loved it.')).toBeLessThan(HEATED_THRESHOLD);
  });
});

describe('isHeated', () => {
  it('flags an inflammatory post', () => {
    expect(isHeated(makeStatus('<p>You are all MORONS and LIARS and FRAUDS!!!</p>'))).toBe(true);
  });

  it('passes a normal post', () => {
    expect(isHeated(makeStatus('<p>New blog post about sourdough starters.</p>'))).toBe(false);
  });

  it('checks the boost target, not the empty wrapper', () => {
    const heated = makeStatus('<p>hate hate this disgusting outrage</p>');
    expect(isHeated(makeStatus('', { reblog: heated }))).toBe(true);
  });

  it('reads the content warning text too', () => {
    expect(isHeated(makeStatus('<p>…</p>', { spoiler_text: 'unhinged rage inside' }))).toBe(true);
  });

  it('any content warning counts as negative sentiment, however mild', () => {
    expect(isHeated(makeStatus('<p>lunch photos</p>', { spoiler_text: 'food' }))).toBe(true);
  });

  it('a viewer content-filter match counts as negative sentiment', () => {
    const filtered = makeStatus('<p>perfectly pleasant words</p>', {
      filtered: [
        {
          filter: {
            id: 'f1',
            title: 'Discourse',
            context: ['home'],
            expires_at: null,
            filter_action: 'warn',
          },
          keyword_matches: null,
          status_matches: null,
        },
      ],
    });
    expect(isHeated(filtered)).toBe(true);
  });
});
