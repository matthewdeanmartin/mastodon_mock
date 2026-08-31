import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { STARTER_KITS } from '../../starter-collection';

// i18n bundledStarterKits.title: Bundled starter kits
// i18n bundledStarterKits.intro: Curated lists assembled by the developer of Mawkingbird — not collections anyone published on a server, just a hand-picked set of accounts to get a new timeline off the ground. Follow the whole set or pick through it.
// i18n bundledStarterKits.account.one: {{count}} account
// i18n bundledStarterKits.account.other: {{count}} accounts
// i18n bundledStarterKits.open: · open the kit →

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
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './bundled-starter-kits.html',
  styleUrl: './bundled-starter-kits.css',
})
export class BundledStarterKits {
  protected readonly kits = STARTER_KITS;

  protected linkFor(slug: string): string {
    return slug === 'starter' ? '/collections/starter' : `/collections/starter/${slug}`;
  }
}
