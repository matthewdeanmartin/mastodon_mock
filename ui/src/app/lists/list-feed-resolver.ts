import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { Api } from '../api';
import { Status } from '../models';

/** How many statuses to pull per member when synthesizing a merged feed. */
export const FEED_PER_MEMBER = 20;
/** Cap on the merged feed length. */
export const FEED_MAX = 40;
/** Cap on how many members we fan out to (real mastodon.social latency guard —
 *  see the forkJoin latency note in sprint/lists-0-overview.md). */
export const MERGE_MEMBER_CAP = 12;

/** Result of a client-side member-timeline merge. */
export interface MergedFeed {
  statuses: Status[];
  /** True when we capped the member fan-out and only merged the first N. */
  capped: boolean;
  cappedFrom: number;
}

/**
 * Turns member accounts into one reverse-chronological feed by fetching each
 * member's recent statuses and merging them. This is the client-side synthesis
 * that `CollectionPage` used to inline; it is shared here so collections and
 * endorsed-account lists (and any future account-backed source) use one code
 * path. The API has no collection/endorsement timeline endpoint, so this is the
 * only honest way to build the feed (see sprint/lists-0-overview.md).
 */
@Injectable({ providedIn: 'root' })
export class ListFeedResolver {
  private api = inject(Api);

  /**
   * Merge each account's recent statuses into one feed.
   * Fans out to at most {@link MERGE_MEMBER_CAP} accounts; per-account failures
   * degrade to an empty contribution rather than failing the whole merge.
   */
  mergeMemberTimelines(accountIds: string[]): Observable<MergedFeed> {
    const capped = accountIds.length > MERGE_MEMBER_CAP;
    const ids = accountIds.slice(0, MERGE_MEMBER_CAP);
    if (!ids.length) {
      return of({ statuses: [], capped: false, cappedFrom: 0 });
    }
    return forkJoin(
      ids.map((id) =>
        this.api
          .getAccountStatuses(id, { excludeReplies: true, limit: FEED_PER_MEMBER })
          .pipe(catchError(() => of([] as Status[]))),
      ),
    ).pipe(
      map((lists) => ({
        statuses: lists
          .flat()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, FEED_MAX),
        capped,
        cappedFrom: accountIds.length,
      })),
    );
  }
}
