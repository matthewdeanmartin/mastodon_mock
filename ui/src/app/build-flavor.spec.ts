import { brandLogoSrc, failWhaleArt, isCanaryBuild } from './build-flavor';

describe('build-flavor', () => {
  it('detects canary from a /canary/ base href', () => {
    expect(isCanaryBuild('https://mawkingbird.com/canary/')).toBe(true);
    expect(isCanaryBuild('https://mawkingbird.com/canary')).toBe(true);
  });

  it('treats production and sub-paths that merely contain "canary" correctly', () => {
    expect(isCanaryBuild('https://mawkingbird.com/')).toBe(false);
    expect(isCanaryBuild('https://mawkingbird.com/canary-notes/')).toBe(false);
    expect(isCanaryBuild('http://localhost:4200/')).toBe(false);
  });

  it('falls back to production on an unparseable base href', () => {
    expect(isCanaryBuild('not a url')).toBe(false);
  });

  it('picks the canary logo only on canary', () => {
    expect(brandLogoSrc('ai', 'https://mawkingbird.com/canary/')).toBe('canary_logo_104.png');
    expect(brandLogoSrc('ai', 'https://mawkingbird.com/')).toBe('mockigbird_logo_104.png');
  });

  it('picks the hand-drawn mark by default, on both flavors', () => {
    expect(brandLogoSrc(undefined, 'https://mawkingbird.com/canary/')).toBe('canary_hand_104.png');
    expect(brandLogoSrc(undefined, 'https://mawkingbird.com/')).toBe('mockingbird_hand_104.png');
  });

  it('keeps canary distinguishable in either illustration set', () => {
    // The two dimensions are independent: canary must not look like production
    // just because the reader switched the artwork.
    for (const style of ['hand', 'ai'] as const) {
      expect(brandLogoSrc(style, 'https://mawkingbird.com/canary/')).not.toBe(
        brandLogoSrc(style, 'https://mawkingbird.com/'),
      );
    }
  });

  it('carries each whale drawing its own true shape', () => {
    // A wrong width/height here stretches the art — the whole reason the
    // dimensions live with the file rather than in each template.
    expect(failWhaleArt('ai')).toEqual({
      src: 'insufficient_whale_640.png',
      width: 640,
      height: 480,
    });
    expect(failWhaleArt('hand')).toEqual({
      src: 'insufficient_whale_hand_640.png',
      width: 640,
      height: 451,
    });
    expect(failWhaleArt()).toEqual(failWhaleArt('hand'));
  });
});
