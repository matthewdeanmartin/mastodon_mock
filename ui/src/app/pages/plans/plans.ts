import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PLUS_PRICE_USD_PER_YEAR,
  PROXY_RATE_FREE_PER_MINUTE,
  PROXY_RATE_PLUS_PER_MINUTE,
} from '../../plus-benefits';
import { FREE_DAILY_ARTICLES } from '../../providers/article/article-quota';

/**
 * "Plans" — the exhaustive tier reference.
 *
 * ## Why this page exists
 *
 * The Plus pitch used to carry its own numbers: "60 requests a minute, counted
 * per address", "2 fetched articles each day". Both are true and neither helps
 * anyone decide. A reader cannot tell whether 60 requests a minute is generous
 * or stingy without knowing how many requests reading a feed costs, and nobody
 * outside this repo knows that. Printed on a badge with no room to explain, a
 * number like that is worse than no number: it looks like a limit being
 * imposed, and the reader has no way to judge it.
 *
 * So the pitch dropped to two rows of plain outcomes (`plus-benefits.ts`) and
 * the numbers moved here, where there is room to say what they mean. This is
 * the page for someone who has already decided they care.
 *
 * ## Why it is not a virtual tweet
 *
 * Design, Funding and Credits render through `StatusCard` as synthetic posts,
 * and that is the right treatment for prose. This page is a comparison table
 * across three tiers, and StatusCard sanitises to Mastodon post markup — the
 * Funding page already notes that nested lists do not survive the trip, and a
 * `<table>` would not either. So it is a plain page using the global
 * `.page-head` style, the same shape as the other tabular pages.
 *
 * ## Why the numbers are imported, not typed
 *
 * Every number here is the constant the running code enforces. A reference page
 * that drifts from the gate it documents is the exact failure `plus-benefits.ts`
 * was written to end, and it would fail worse here — this is the page people
 * will quote back.
 */
@Component({
  selector: 'app-plans',
  imports: [RouterLink],
  templateUrl: './plans.html',
  styleUrl: './plans.css',
})
export class Plans {
  protected readonly priceUsd = PLUS_PRICE_USD_PER_YEAR;
  protected readonly freeArticles = FREE_DAILY_ARTICLES;
  protected readonly proxyFreeRate = PROXY_RATE_FREE_PER_MINUTE;
  protected readonly proxyPlusRate = PROXY_RATE_PLUS_PER_MINUTE;
}
