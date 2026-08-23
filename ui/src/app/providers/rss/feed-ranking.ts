/** A feed candidate found on a page, as {@link feedLinksIn} returns it. */
export interface FeedCandidate {
  url: string;
  title: string;
}

/**
 * Order feed candidates so the best guess comes first.
 *
 * ## Why ranking rather than picking
 *
 * One page routinely declares several feeds — WordPress alone publishes a main
 * feed, a comments feed, and often per-category ones. Someone who pasted a site
 * root wants the site, but nothing in the markup says which of the three that
 * is: they are all `rel="alternate"` and all valid.
 *
 * So this ranks rather than chooses. The caller shows every candidate with the
 * top one pre-selected, which is what makes an imperfect heuristic survivable:
 * a wrong guess costs one extra click, not a confusing subscription the user
 * cannot explain. **If the UI ever hides the alternatives, this ranking stops
 * being good enough** — it is not accurate enough to be the only answer.
 *
 * ## Determinism
 *
 * Ties break on the URL, so the same page always produces the same pre-pick.
 * A pre-pick that moved between two visits would be worse than no pre-pick:
 * the user would have no way to learn what the app does.
 */

/** Paths and words that mark a comments feed. */
const COMMENT_HINTS = [/\/comments\/?(feed|rss|atom)?\/?$/i, /comment/i];

/** Path shapes that mark a narrower-than-the-site feed. */
const NARROW_HINTS = [/\/(category|categories|tag|tags|label|topic|author)\//i, /[?&]cat=/i];

/** Score one candidate. Lower sorts first. */
function score(candidate: FeedCandidate, pageTitle: string): number {
  let points = 0;
  let path: string;
  let segments: number;
  try {
    const url = new URL(candidate.url);
    path = url.pathname + url.search;
    segments = url.pathname.split('/').filter(Boolean).length;
  } catch {
    // Unparseable shouldn't reach here (feedLinksIn resolves and validates), but
    // ranking must not throw on it either — sort it last and move on.
    return Number.MAX_SAFE_INTEGER;
  }

  const haystack = `${path} ${candidate.title}`;

  // 1. Comments feeds are near-never what someone means, and are the single most
  //    common wrong pick. Heaviest demotion.
  if (COMMENT_HINTS.some((re) => re.test(haystack))) {
    points += 1000;
  }

  // 2. A feed scoped to one category or tag is a subset of the thing that was
  //    asked for.
  if (NARROW_HINTS.some((re) => re.test(path))) {
    points += 100;
  }

  // 3. Shorter paths are more likely to be the site's own feed: `/feed` beats
  //    `/blog/tech/feed`.
  points += segments * 5;

  // 4. A feed titled like the page is the page's feed. Only a nudge — many
  //    correct feeds are titled "Feed" or "RSS" and would lose rule 3 otherwise.
  if (pageTitle && titlesRelated(candidate.title, pageTitle)) {
    points -= 3;
  }

  return points;
}

/** Whether a feed title and a page title plausibly name the same publication. */
function titlesRelated(feedTitle: string, pageTitle: string): boolean {
  const normalise = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(feed|rss|atom|comments?|blog)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const feed = normalise(feedTitle);
  const page = normalise(pageTitle);
  if (!feed || !page) {
    return false;
  }
  return page.includes(feed) || feed.includes(page);
}

/**
 * Rank candidates best-first.
 *
 * `pageTitle` is the `<title>` of the page they were declared on, when known —
 * it is evidence for rule 4 and simply skipped when absent.
 */
export function rankFeeds(candidates: readonly FeedCandidate[], pageTitle = ''): FeedCandidate[] {
  return [...candidates].sort((a, b) => {
    const diff = score(a, pageTitle) - score(b, pageTitle);
    if (diff !== 0) {
      return diff;
    }
    // Deterministic tiebreak: Atom before RSS where the URL says so, then the
    // URL itself. Arbitrary, but stable — which is the property that matters.
    const atomness = Number(/atom/i.test(b.url)) - Number(/atom/i.test(a.url));
    return atomness !== 0 ? atomness : a.url.localeCompare(b.url);
  });
}
