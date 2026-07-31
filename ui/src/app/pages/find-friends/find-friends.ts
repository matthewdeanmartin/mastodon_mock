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
 */
@Component({
  selector: 'app-find-friends',
  imports: [RouterLink],
  templateUrl: './find-friends.html',
  styleUrl: './find-friends.css',
})
export class FindFriends {
  protected auth = inject(Auth);
}
