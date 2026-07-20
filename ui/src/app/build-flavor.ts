/**
 * Runtime "which deployment am I?" helpers, derived from the <base href>.
 *
 * The canary site is built with a /canary/ base href (MOCKINGBIRD_BASE_HREF in
 * .github/workflows/mockingbird-canary.yml); production uses /. That base href
 * is the only reliable signal available in the browser, so we read it from
 * document.baseURI rather than baking a flag into the build.
 */

/** True when the app is served from the /canary/ sub-path. */
export function isCanaryBuild(baseUri: string = document.baseURI): boolean {
  try {
    return new URL(baseUri).pathname.replace(/\/+$/, '').endsWith('/canary');
  } catch {
    return false;
  }
}

/** Brand-mark image (104px @2x): the canary logo on canary, else the normal one. */
export function brandLogoSrc(baseUri: string = document.baseURI): string {
  return isCanaryBuild(baseUri) ? 'canary_logo_104.png' : 'mockigbird_logo_104.png';
}
