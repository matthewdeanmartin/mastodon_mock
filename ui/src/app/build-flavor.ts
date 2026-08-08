/**
 * Runtime "which deployment am I?" helpers, derived from the <base href>.
 *
 * The canary site is built with a /canary/ base href (MOCKINGBIRD_BASE_HREF in
 * .github/workflows/mockingbird-canary.yml); production uses /. That base href
 * is the only reliable signal available in the browser, so we read it from
 * document.baseURI rather than baking a flag into the build.
 */

// Type-only: ClientPrefs imports this module, so a value import would be a cycle.
import type { ArtStyle } from './client-prefs';

/** True when the app is served from the /canary/ sub-path. */
export function isCanaryBuild(baseUri: string = document.baseURI): boolean {
  try {
    return new URL(baseUri).pathname.replace(/\/+$/, '').endsWith('/canary');
  } catch {
    return false;
  }
}

/**
 * Brand-mark image (104px @2x): the canary logo on canary, else the normal one,
 * in whichever illustration set the reader prefers (see {@link ArtStyle}).
 *
 * The two dimensions are independent — canary still has to look like canary
 * whichever art is on — so both files exist for both flavors.
 */
export function brandLogoSrc(style: ArtStyle = 'hand', baseUri: string = document.baseURI): string {
  if (style === 'ai') {
    return isCanaryBuild(baseUri) ? 'canary_logo_104.png' : 'mockigbird_logo_104.png';
  }
  return isCanaryBuild(baseUri) ? 'canary_hand_104.png' : 'mockingbird_hand_104.png';
}

/**
 * Fail-whale illustration, with its intrinsic size.
 *
 * The dimensions travel with the file rather than being written into each
 * template: the two drawings are not the same shape (4:3 generated, 640x451
 * hand-drawn), and an `<img>` carrying the wrong width/height attributes
 * stretches the art — see the `height: auto` note in the demo page's styles.
 */
export interface WhaleArt {
  src: string;
  width: number;
  height: number;
}

const WHALES: Record<ArtStyle, WhaleArt> = {
  ai: { src: 'insufficient_whale_640.png', width: 640, height: 480 },
  hand: { src: 'insufficient_whale_hand_640.png', width: 640, height: 451 },
};

/** Fail-whale illustration, in the reader's preferred illustration set. */
export function failWhaleArt(style: ArtStyle = 'hand'): WhaleArt {
  return WHALES[style] ?? WHALES.hand;
}
