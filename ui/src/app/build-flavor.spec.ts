import { brandLogoSrc, isCanaryBuild } from './build-flavor';

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
    expect(brandLogoSrc('https://mawkingbird.com/canary/')).toBe('canary_logo_104.png');
    expect(brandLogoSrc('https://mawkingbird.com/')).toBe('mockigbird_logo_104.png');
  });
});
