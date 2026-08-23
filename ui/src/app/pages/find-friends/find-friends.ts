import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../auth';

/**
 * Find Friends: a hub for every route in the app that ends in "…and now you
 * follow someone".
 *
 * Pure navigation, in the same shape as {@link Docs} — a list of rows, each a
 * link with one line saying what it is for. It exists because those routes had
 * spread across the More menu (Starter Kits), Settings (import a follow list),
 * and the search page, with nothing connecting them. Someone new does not know
 * which of those they want; they know they want people to follow.
 *
 * Collapsing them into one entry also bought back a slot in the More menu, which
 * is the practical reason this landed now.
 *
 * Anonymous accounts see a reduced set: importing a follow list and sending
 * invites both need a real account on an instance, so those rows would be dead
 * ends. Search and the people browser work for everyone.
 *
 * ## Ordering
 *
 * Rows are ordered by how well each works for someone who has been here five
 * minutes, and the ones that need prior knowledge sit under an **Advanced**
 * heading. Starter kits lead: they are the only option that needs no name, no
 * typing and no leaving the site. Off-site directories are the clearest case
 * for demotion — following someone found there means reading a handle
 * elsewhere, coming back, and searching for it by hand.
 */
@Component({
  selector: 'app-find-friends',
  imports: [RouterLink],
  templateUrl: './find-friends.html',
  styleUrl: './find-friends.css',
})
export class FindFriends {
  protected auth = inject(Auth);

  /**
   * Suggested subjects, as links into post search.
   *
   * Not a curated directory and not personalised — they are examples, and their
   * job is to answer "what would I even type" for someone facing an empty
   * search box. Broad enough that each returns something on a general-purpose
   * server, and deliberately not all tech: a list of programming languages
   * would tell a new visitor this app is not for them.
   *
   * Plain strings because each is only ever a query. Anything richer would be a
   * curation surface, which is what `/bundled-starter-kits` already is.
   */
  protected readonly interests: readonly string[] = [
    'photography',
    'gardening',
    'books',
    'cooking',
    'birds',
    'music',
    'art',
    'history',
    'science',
    'cycling',
    'movies',
    'knitting',
  ];
}
