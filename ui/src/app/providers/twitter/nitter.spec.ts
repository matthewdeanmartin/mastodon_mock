import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NITTER_HOST, nitterHost, setNitterHost, toNitterUrl } from './nitter';

describe('toNitterUrl', () => {
  beforeEach(() => localStorage.clear());

  it('rewrites an x.com post onto the configured instance', () => {
    expect(toNitterUrl('https://x.com/NASA/status/123')).toBe(
      `https://${DEFAULT_NITTER_HOST}/NASA/status/123`,
    );
  });

  it('rewrites a profile URL', () => {
    expect(toNitterUrl('https://x.com/mistersql')).toBe(`https://${DEFAULT_NITTER_HOST}/mistersql`);
  });

  it.each([
    'https://twitter.com/NASA/status/1',
    'https://www.twitter.com/NASA/status/1',
    'https://mobile.twitter.com/NASA/status/1',
    'https://www.x.com/NASA/status/1',
  ])('rewrites the legacy and www hosts too: %s', (url) => {
    expect(toNitterUrl(url)).toContain(DEFAULT_NITTER_HOST);
    expect(toNitterUrl(url)).not.toContain('twitter.com');
  });

  it('leaves a non-X link alone', () => {
    // RSS items point at their publisher; rewriting those would be nonsense.
    const url = 'https://example.com/article';
    expect(toNitterUrl(url)).toBe(url);
  });

  it('returns a malformed URL unchanged rather than throwing', () => {
    // This is a convenience; a link that cannot be rewritten should still work.
    expect(toNitterUrl('not a url')).toBe('not a url');
  });

  it('handles a missing URL', () => {
    expect(toNitterUrl(null)).toBeNull();
    expect(toNitterUrl(undefined)).toBeNull();
  });

  it('preserves query and fragment', () => {
    expect(toNitterUrl('https://x.com/NASA/status/1?s=20#reply')).toBe(
      `https://${DEFAULT_NITTER_HOST}/NASA/status/1?s=20#reply`,
    );
  });
});

describe('the configured instance', () => {
  beforeEach(() => localStorage.clear());

  it('defaults when nothing is set', () => {
    expect(nitterHost()).toBe(DEFAULT_NITTER_HOST);
  });

  it('uses a chosen instance', () => {
    setNitterHost('nitter.example.org');
    expect(toNitterUrl('https://x.com/NASA')).toBe('https://nitter.example.org/NASA');
  });

  it('normalizes a pasted URL down to a host', () => {
    // People paste what is in their address bar; requiring a bare hostname
    // would reject the most likely input.
    setNitterHost('https://nitter.example.org/');
    expect(nitterHost()).toBe('nitter.example.org');
  });

  it('restores the default when cleared', () => {
    setNitterHost('nitter.example.org');
    setNitterHost('');
    expect(nitterHost()).toBe(DEFAULT_NITTER_HOST);
  });
});
