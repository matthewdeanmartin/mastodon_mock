import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';
import { Auth } from './auth';
import { Relationship } from './models';

/**
 * Who the viewer follows, resolved in batches and shared across the app.
 *
 * ## Why this exists
 *
 * Three places wanted the same answer and none of them agreed on it. The
 * collection page had no follow affordance at all — a curated list of people
 * whose entire purpose is to be followed, with no way to follow any of them and
 * no indication of who you already follow, so the only way through it was to
 * open every member in a new tab. `feed-members` resolved follow state
 * correctly and then rendered no button with it. `bulk-actions` batched at 40
 * while the other two batched at 80.
 *
 * 40 is the right number: it is Mastodon's documented cap for
 * `/accounts/relationships`, and a request for 80 ids quietly comes back with
 * the first 40 — which reads as "you don't follow these people" for everyone
 * past the cap.
 *
 * ## What it holds
 *
 * The relationship for each account id we have asked about. Follow and unfollow
 * write through here, so a row in one component reflects a follow made from
 * another without a refetch.
 *
 * In memory only, for the session. Follow state is cheap to re-ask and
 * catastrophic to get wrong from cache: a stale "following" hides the button
 * that would let you follow them.
 */

/** Mastodon caps `/accounts/relationships` at 40 ids per request. */
export const RELATIONSHIP_BATCH = 40;

/** What the button should show for one account. */
export type FollowStatus =
  /** Not asked yet, or the viewer is anonymous — render nothing. */
  | 'unknown'
  | 'following'
  /** A follow request is in with a locked account, awaiting their decision. */
  | 'requested'
  | 'not-following';

@Injectable({ providedIn: 'root' })
export class FollowState {
  private api = inject(Api);
  private auth = inject(Auth);

  private known = signal<Record<string, Relationship>>({});
  /** Ids with a write in flight, so the button can disable itself. */
  private busy = signal<ReadonlySet<string>>(new Set());
  private pending = new Map<string, Promise<void>>();

  /** What we know about this account without asking. */
  status(id: string): FollowStatus {
    const rel = this.known()[id];
    if (!rel) {
      return 'unknown';
    }
    if (rel.following) {
      return 'following';
    }
    return rel.requested ? 'requested' : 'not-following';
  }

  busyWith(id: string): boolean {
    return this.busy().has(id);
  }

  /**
   * Resolve these accounts, skipping any already known.
   *
   * Anonymous viewers are answered with silence rather than a request: there is
   * no relationship to have, and the endpoint would 401.
   */
  async resolve(ids: string[]): Promise<void> {
    if (this.auth.isAnonymous) {
      return;
    }
    const unique = [...new Set(ids)];
    // Anything already in flight is awaited rather than re-requested: two
    // components mounting against the same collection should cost one call.
    const inFlight = unique.map((id) => this.pending.get(id)).filter((p): p is Promise<void> => !!p);
    const wanted = unique.filter((id) => !this.known()[id] && !this.pending.has(id));

    const batches: Promise<void>[] = [];
    for (let i = 0; i < wanted.length; i += RELATIONSHIP_BATCH) {
      const slice = wanted.slice(i, i + RELATIONSHIP_BATCH);
      const batch = this.fetch(slice).finally(() => {
        for (const id of slice) {
          this.pending.delete(id);
        }
      });
      for (const id of slice) {
        this.pending.set(id, batch);
      }
      batches.push(batch);
    }
    await Promise.all([...batches, ...inFlight]);
  }

  private async fetch(ids: string[]): Promise<void> {
    try {
      const rels = await firstValueFrom(this.api.relationships(ids));
      this.write(rels);
    } catch {
      // Leave them 'unknown': a row with no button is better than a row whose
      // button claims a relationship we failed to read.
    }
  }

  /**
   * Follow, or unfollow, updating optimistically.
   *
   * Optimistic because the button is the whole interaction and a spinner on
   * every click through a list of forty people is its own kind of unusable. The
   * rollback matters more than the optimism: a failed follow that keeps saying
   * "Following" is a lie the user acts on.
   *
   * Returns whether it worked, so a caller can surface the failure.
   */
  async toggle(id: string): Promise<boolean> {
    if (this.auth.isAnonymous || this.busyWith(id)) {
      return false;
    }
    const before = this.known()[id];
    const wasConnected = !!before && (before.following || before.requested);

    this.setBusy(id, true);
    // Optimistic: assume the ordinary case (a public account follows straight
    // through). A locked account answers `requested`, and the real response
    // below replaces this guess either way.
    this.write([{ ...(before ?? emptyRelationship(id)), following: !wasConnected, requested: false }]);

    try {
      const rel = await firstValueFrom(
        wasConnected ? this.api.unfollow(id) : this.api.follow(id),
      );
      // The server's answer wins — it is the one that knows about locked
      // accounts, and it is what turns an optimistic "Following" into the
      // honest "Requested".
      this.write([rel]);
      return true;
    } catch {
      if (before) {
        this.write([before]);
      } else {
        this.forget(id);
      }
      return false;
    } finally {
      this.setBusy(id, false);
    }
  }

  /** Fold in relationships someone else already fetched. */
  write(rels: Relationship[]): void {
    this.known.update((all) => {
      const next = { ...all };
      for (const rel of rels) {
        next[rel.id] = rel;
      }
      return next;
    });
  }

  /** Drop everything — used when the signed-in account changes. */
  reset(): void {
    this.known.set({});
    this.busy.set(new Set());
    this.pending.clear();
  }

  private forget(id: string): void {
    this.known.update((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  private setBusy(id: string, busy: boolean): void {
    this.busy.update((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}

/** A relationship placeholder for an account we are writing to before reading. */
function emptyRelationship(id: string): Relationship {
  return {
    id,
    following: false,
    followed_by: false,
    requested: false,
    blocking: false,
    muting: false,
  };
}
