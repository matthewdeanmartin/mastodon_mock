import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { StarterKitPost } from '../../starter-kit-post/starter-kit-post';
import { SHIPPED_STARTER_KITS } from '../../starter-kits';

// i18n bundledCollections.title: Bundled collections
// i18n bundledCollections.intro: These are real collections, curated by real people on their own instances — snapshotted and shipped with Mawkingbird so you can find them at all. Mastodon has no way to search for collections yet, so the only ones anyone can reach are the ones they were sent a link to. Open one to see its members and sample what they post.

/**
 * Bundled collections: snapshots of real Mastodon collections, shipped in code.
 *
 * This page exists because collection *search* does not. Collections are a
 * Mastodon 4.6 feature with no discovery endpoint — there is no way to ask a
 * server "what collections exist here", so the only ones anybody can find are
 * the ones they were handed a link to. Until that changes, a handful of good
 * ones travel with the app.
 *
 * These used to be injected into the home feed of anyone with few follows,
 * which meant the same five collections in front of the same person on every
 * new browser, forever. They live here now, where someone arrives on purpose.
 *
 * Distinct from {@link BundledStarterKits}: these are other people's real
 * collections, curated by their own authors on their own instances. The starter
 * kits are assembled by this app's developer.
 */
@Component({
  selector: 'app-bundled-collections',
  imports: [StarterKitPost, TranslocoPipe],
  templateUrl: './bundled-collections.html',
  styleUrl: './bundled-collections.css',
})
export class BundledCollections {
  protected readonly collections = SHIPPED_STARTER_KITS;
}
