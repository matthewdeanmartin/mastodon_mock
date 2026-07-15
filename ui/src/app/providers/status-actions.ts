import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Api } from '../api';
import { Status } from '../models';
import { BlueskyApi } from './bluesky/bluesky-api';
import { BskyRef } from './bluesky/bluesky-types';

/**
 * Routes favourite/boost toggles to the network a status came from, so
 * StatusCard needs no provider knowledge. Mastodon statuses go through `Api`
 * exactly as before; Bluesky ones create/delete like and repost records
 * (keeping the record uri in `providerRef` so the toggle can be undone).
 * RSS never gets here — its capabilities hide the buttons.
 */
@Injectable({ providedIn: 'root' })
export class StatusActions {
  private api = inject(Api);
  private bsky = inject(BlueskyApi);

  toggleFavourite(status: Status): Observable<Status> {
    if (status.provider === 'bluesky') {
      const ref = status.providerRef as BskyRef;
      if (status.favourited && ref.likeUri) {
        return this.bsky.deleteRecord(ref.likeUri).pipe(
          map(() => ({
            ...status,
            favourited: false,
            favourites_count: Math.max(0, status.favourites_count - 1),
            providerRef: { ...ref, likeUri: null },
          })),
        );
      }
      return this.bsky.like(ref.uri, ref.cid).pipe(
        map((created) => ({
          ...status,
          favourited: true,
          favourites_count: status.favourites_count + 1,
          providerRef: { ...ref, likeUri: created.uri },
        })),
      );
    }
    return status.favourited ? this.api.unfavourite(status.id) : this.api.favourite(status.id);
  }

  toggleReblog(status: Status): Observable<Status> {
    if (status.provider === 'bluesky') {
      const ref = status.providerRef as BskyRef;
      if (status.reblogged && ref.repostUri) {
        return this.bsky.deleteRecord(ref.repostUri).pipe(
          map(() => ({
            ...status,
            reblogged: false,
            reblogs_count: Math.max(0, status.reblogs_count - 1),
            providerRef: { ...ref, repostUri: null },
          })),
        );
      }
      return this.bsky.repost(ref.uri, ref.cid).pipe(
        map((created) => ({
          ...status,
          reblogged: true,
          reblogs_count: status.reblogs_count + 1,
          providerRef: { ...ref, repostUri: created.uri },
        })),
      );
    }
    return status.reblogged ? this.api.unreblog(status.id) : this.api.reblog(status.id);
  }
}
