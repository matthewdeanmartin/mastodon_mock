import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STARTER_KITS } from '../../starter-collection';

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
  protected readonly kits = STARTER_KITS;

  protected linkFor(slug: string): string {
    return slug === 'starter' ? '/collections/starter' : `/collections/starter/${slug}`;
  }
}
