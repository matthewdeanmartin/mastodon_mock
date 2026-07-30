/**
 * House ads shown in the right rail.
 *
 * This file IS the ad inventory — to add, remove or reword an ad, edit the
 * array below and rebuild. No other code changes needed.
 *
 * Only {@link HOUSE_ADS_SHOWN} of them are on screen at a time, they rotate on
 * a timer, each can be switched off for good in Settings → Ads, and each can be
 * dismissed for the rest of the page's life. All of that behaviour lives in
 * `HouseAdStore`; this file stays inert data so the inventory can be reworded
 * without reading any of it.
 *
 * The donate links in the rail's Fediverse card are deliberately NOT ads. They
 * ask for money for someone else's server instead of promoting something of
 * ours, they are always shown, and none of the machinery here governs them.
 */
export interface HouseAd {
  /**
   * Stable identity, used for the click tally and the off switch. Do not reuse
   * one for different copy — the stored click count would carry over and start
   * describing an ad nobody ever saw.
   */
  id: string;
  /** Headline, shown bold. Lead with an emoji if you want one. */
  title: string;
  /** One or two short sentences of body copy. */
  text: string;
  /** Where clicking the ad goes (opened in a new tab). */
  url: string;
  /** Call-to-action line, e.g. "Get it on GitHub ↗". */
  cta: string;
}

/** How many ads are on screen at once, however many the inventory holds. */
export const HOUSE_ADS_SHOWN = 2;

export const HOUSE_ADS: HouseAd[] = [
  {
    id: 'mastodon-mock',
    title: '🦣 Mastodon Mock',
    text: 'Mock Mastodon server, mock the REST API for testing. MIT',
    url: 'https://github.com/matthewdeanmartin/mastodon_mock/',
    cta: 'Get it on GitHub ↗',
  },
  {
    id: 'mimb-lite',
    title: '🪶 MIMB lite',
    text: 'The blog-style Mastodon reader, right in your browser.',
    url: 'https://matthewdeanmartin.github.io/mastodon_is_my_blog/mimb_lite/index.html',
    cta: 'Open MIMB lite ↗',
  },
  {
    id: 'youtuber-finder',
    title: '📺 YouTuber Finder',
    text: 'Find people that are big on YouTube and Mastodon.',
    url: 'https://matthewdeanmartin.github.io/youtuberfinder/',
    cta: 'Try YouTuber Finder ↗',
  },
];
