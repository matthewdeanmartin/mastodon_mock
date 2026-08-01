import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STARTER_COLLECTION } from '../../starter-collection';

/** One hand-assembled starter kit, as this page renders it. */
interface BundledKit {
  /** Route to the kit's own page. */
  link: string;
  title: string;
  blurb: string;
  memberCount: number;
}

/**
 * Bundled starter kits: sets of accounts assembled by this app's developer.
 *
 * Deliberately a list rather than a single hard-coded card, because the
 * universal kit is meant to become several themed ones as special-interest
 * sets get generated. Adding one should be an entry in {@link KITS}, not a
 * layout change.
 *
 * Distinct from {@link BundledCollections}: those are snapshots of other
 * people's real Mastodon collections, curated by their own authors. These are
 * ours, and carry no claim to be anything else.
 */
@Component({
  selector: 'app-bundled-starter-kits',
  imports: [RouterLink],
  templateUrl: './bundled-starter-kits.html',
  styleUrl: './bundled-starter-kits.css',
})
export class BundledStarterKits {
  protected readonly kits: readonly BundledKit[] = [
    {
      link: '/collections/starter',
      title: 'Universal starter kit',
      blurb:
        'A general-purpose mix of projects, reporting, art, history, science, and delightful bots — the one to take if you have no idea where to begin.',
      memberCount: STARTER_COLLECTION.length,
    },
  ];
}
