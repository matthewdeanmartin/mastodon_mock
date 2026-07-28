import { describe, expect, it } from 'vitest';
import {
  buildMessageUrl,
  messageStatus,
  messageStatusRouteRef,
  parseMessageParams,
  parseMessageStatusRouteRef,
} from './message-payload';

const BASE = 'https://mawkingbird.com/';

describe('message-payload', () => {
  it('encodes content, CW (from title), and language into the message URL', () => {
    const url = buildMessageUrl(
      { title: 'spicy take', content: 'why did the chicken cross the road?', language: 'markdown' },
      BASE,
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://mawkingbird.com/message/');
    expect(parsed.searchParams.get('m')).toBe('why did the chicken cross the road?');
    expect(parsed.searchParams.get('cw')).toBe('spicy take');
    expect(parsed.searchParams.get('l')).toBe('markdown');
  });

  it('omits empty CW and default language', () => {
    const url = buildMessageUrl({ title: '  ', content: 'hello', language: 'plaintext' }, BASE);
    const parsed = new URL(url);
    expect(parsed.searchParams.has('cw')).toBe(false);
    expect(parsed.searchParams.has('l')).toBe(false);
    expect(parsed.searchParams.get('m')).toBe('hello');
  });

  it('round-trips through parseMessageParams', () => {
    const url = buildMessageUrl(
      { title: 'cw', content: 'body & <stuff>', language: 'python' },
      BASE,
    );
    const payload = parseMessageParams(new URL(url).searchParams);
    expect(payload).toEqual({ content: 'body & <stuff>', spoiler: 'cw', language: 'python' });
  });

  it('returns null when no message param is present', () => {
    expect(parseMessageParams(new URLSearchParams('foo=bar'))).toBeNull();
  });

  describe('nesting inside another URL', () => {
    // The message URL is handed to a shortener as the value of `?url=`, so it
    // gets decoded by a stranger before anyone reads it back. `+` is the trap:
    // RFC 3986 calls it a literal plus, form-encoding calls it a space, and the
    // hops disagree — which is how a recipe turned into
    // "Tofu+salad+sandwich+recipe%3A%0A". Encoding space as %20 removes the
    // ambiguity, so the result must survive either convention.
    const multiline = 'Tofu salad sandwich recipe:\n- tofu\n- salad\n- bread';

    it('never encodes a space as +', () => {
      const url = buildMessageUrl(
        { title: 'a b', content: multiline, language: 'plaintext' },
        BASE,
      );
      expect(url).not.toContain('+');
      expect(url).toContain('%20');
    });

    it('survives a recipient that treats + as a literal', () => {
      const target = buildMessageUrl(
        { title: '', content: multiline, language: 'plaintext' },
        BASE,
      );
      const nested = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(target)}`;
      const stored = decodeURIComponent(nested.split('url=')[1]);
      expect(parseMessageParams(new URL(stored).searchParams)?.content).toBe(multiline);
    });

    it('survives a recipient that treats + as a space', () => {
      const target = buildMessageUrl(
        { title: '', content: multiline, language: 'plaintext' },
        BASE,
      );
      const nested = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(target)}`;
      const stored = decodeURIComponent(nested.split('url=')[1].replace(/\+/g, ' '));
      expect(parseMessageParams(new URL(stored).searchParams)?.content).toBe(multiline);
    });

    it('still reads a legacy link that used + for spaces', () => {
      // Old links are already out there; readers must not regress.
      expect(parseMessageParams(new URLSearchParams('m=Tofu+salad%3A%0A-+tofu'))?.content).toBe(
        'Tofu salad:\n- tofu',
      );
    });
  });

  it('preserves an empty message (m= present but blank)', () => {
    const payload = parseMessageParams(new URLSearchParams('m='));
    expect(payload).toEqual({ content: '', spoiler: '', language: 'plaintext' });
  });

  it('builds an escaped status carrying the CW as spoiler_text', () => {
    const status = messageStatus(
      { content: 'a & b\n<script>', spoiler: 'heads up', language: 'plaintext' },
      'https://tinyurl.com/abc',
    );
    expect(status.content).toBe('a &amp; b<br>&lt;script&gt;');
    expect(status.spoiler_text).toBe('heads up');
    expect(status.sensitive).toBe(true);
    expect(status.url).toBe('https://tinyurl.com/abc');
    expect(status.provider).toBe('paste');
  });

  it('round-trips a payload through the status route ref', () => {
    const payload = { content: 'body & <stuff>\nline2', spoiler: 'cw', language: 'python' };
    const ref = messageStatusRouteRef(payload);
    expect(ref.startsWith('message-status.')).toBe(true);
    expect(parseMessageStatusRouteRef(ref)).toEqual(payload);
  });

  it('encodes URL-unsafe base64 chars safely in the route ref', () => {
    const ref = messageStatusRouteRef({ content: '???>>>', spoiler: '', language: 'plaintext' });
    // base64url alphabet only: no +, /, or = in the segment.
    expect(ref.slice('message-status.'.length)).toMatch(/^[A-Za-z0-9_-]*$/);
  });

  it('returns null for a non-message-status id', () => {
    expect(parseMessageStatusRouteRef('12345')).toBeNull();
    expect(parseMessageStatusRouteRef('anonymous-status.abc')).toBeNull();
  });

  it('returns null when the ref decodes to something without content', () => {
    const bogus = 'message-status.' + btoa('{"spoiler":"x"}');
    expect(parseMessageStatusRouteRef(bogus)).toBeNull();
  });

  it('defaults spoiler and language when the payload omits them', () => {
    const ref = messageStatusRouteRef({ content: 'hi', spoiler: '', language: 'plaintext' });
    expect(parseMessageStatusRouteRef(ref)).toEqual({
      content: 'hi',
      spoiler: '',
      language: 'plaintext',
    });
  });

  it('is not sensitive when there is no CW', () => {
    const status = messageStatus({ content: 'plain', spoiler: '', language: 'plaintext' }, null);
    expect(status.sensitive).toBe(false);
    expect(status.spoiler_text).toBe('');
  });
});
