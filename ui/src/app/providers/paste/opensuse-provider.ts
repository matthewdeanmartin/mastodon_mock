import { inject, Injectable } from '@angular/core';
import { map, Observable, throwError } from 'rxjs';
import { Account, Status } from '../../models';
import { PasteFeedSubscriptions } from './paste-feed-subscriptions';
import { PasteFeedFetch } from './paste-feed-fetch';
import {
  FeedPasteProvider,
  PasteCreateInput,
  PasteCreated,
  PasteRecentItem,
} from './paste-provider';

const SITE = 'https://paste.opensuse.org';
const FEED_URL = `${SITE}/pastes.json`;

const OPENSUSE_ACCOUNT: Account = {
  id: 'paste:opensuse',
  username: 'recent',
  acct: 'recent@paste.opensuse.org',
  display_name: 'openSUSE Paste',
  note: 'Recent public pastes from the openSUSE paste service.',
  url: `${SITE}/pastes`,
  avatar: `${SITE}/favicon.ico`,
  avatar_static: `${SITE}/favicon.ico`,
  header: '',
  followers_count: 0,
  following_count: 0,
  statuses_count: 0,
  bot: false,
  locked: false,
  discoverable: true,
  fields: [],
};

/** One entry of `GET /pastes.json`. */
interface OpensusePaste {
  id: number;
  author: string | null;
  title: string | null;
  private: boolean;
  created_at: string;
  /**
   * NOT the paste body. openSUSE stores contents in Active Storage and returns
   * a `/rails/active_storage/blobs/redirect/...` path here, so using it as a
   * preview would print an opaque signed URL into the timeline. The body lives
   * at `<human_url>/raw`; the timeline entry is built from the title instead,
   * which is the only human-readable text this endpoint actually hands over.
   */
  content: string | null;
  human_url: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The trailing slug of a paste URL, which is its identity on this service. */
function slugOf(humanUrl: string): string {
  const trimmed = humanUrl.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/**
 * openSUSE's paste service as a read-only public feed.
 *
 * `GET /pastes.json` is a genuine JSON API — no HTML scraping — returning a few
 * hundred recent public pastes with titles, authors and timestamps. It sends no
 * CORS header, so reading it from a browser requires the user's own CORS proxy,
 * opted in per feed on the Pastes page (see {@link PasteFeedFetch}).
 *
 * Read-only by design: the service creates pastes through an authenticity-token
 * form flow rather than an API, and forging one from a browser would be both
 * fragile and rude. {@link create} therefore refuses rather than pretending —
 * `PasteProviderRegistry` keeps it out of `all`, so the composer never offers it
 * as a destination and this path is only reachable by a caller ignoring that.
 */
@Injectable({ providedIn: 'root' })
export class OpensuseProvider implements FeedPasteProvider {
  private feedFetch = inject(PasteFeedFetch);
  private subscriptions = inject(PasteFeedSubscriptions);

  readonly id = 'opensuse';
  readonly label = 'openSUSE Paste';
  readonly feedUrl = FEED_URL;
  /** Nothing created here, so nothing to edit or delete. */
  readonly immutable = true;
  readonly visibilities = ['public'] as const;
  readonly languages = [{ value: 'plaintext', label: 'Plain text' }] as const;
  readonly expiries = [] as const;

  create(_input: PasteCreateInput): Observable<PasteCreated> {
    return throwError(
      () =>
        new Error(
          'openSUSE Paste is read-only here — it has no create API, only a web form. ' +
            'Use another provider to post.',
        ),
    );
  }

  update(): Observable<void> {
    return throwError(() => new Error('openSUSE pastes cannot be edited from Mockingbird.'));
  }

  delete(): Observable<void> {
    return throwError(() => new Error('openSUSE pastes cannot be deleted from Mockingbird.'));
  }

  recent(): Observable<PasteRecentItem[]> {
    return this.feedFetch
      .json<OpensusePaste[]>(FEED_URL, this.subscriptions.usesProxy(this.id), this.label)
      .pipe(
        map((pastes) => {
          if (!Array.isArray(pastes)) {
            // A 200 that isn't the documented array means the endpoint changed
            // shape. Say so rather than rendering an empty, healthy-looking feed.
            throw new Error(
              `${this.label} returned something that isn't a list of pastes — the service may have changed its API.`,
            );
          }
          return (
            pastes
              // `private` pastes are excluded even though the endpoint returns
              // them: a public timeline is the wrong place for something its
              // author marked unlisted.
              .filter((paste) => !paste.private && !!paste.human_url)
              .map((paste) => {
                const humanUrl = paste.human_url as string;
                const title = paste.title?.trim() || null;
                return {
                  slug: slugOf(humanUrl),
                  title,
                  language: 'plaintext',
                  // The body is not in this payload (see OpensusePaste.content),
                  // so the author line is the preview. Never the blob path.
                  preview: paste.author?.trim()
                    ? `Posted by ${paste.author.trim()}`
                    : 'Public paste',
                  createdAt: paste.created_at,
                  url: humanUrl,
                  rawUrl: `${humanUrl.replace(/\/+$/, '')}/raw`,
                };
              })
          );
        }),
      );
  }

  status(item: PasteRecentItem): Status {
    const title = item.title?.trim();
    const content = title
      ? `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(item.preview)}`
      : escapeHtml(item.preview);
    return {
      provider: 'paste',
      providerRef: { providerId: this.id, slug: item.slug },
      id: `paste:${this.id}:${item.slug}`,
      created_at: item.createdAt,
      edited_at: null,
      content,
      spoiler_text: '',
      visibility: 'public',
      url: item.url,
      account: OPENSUSE_ACCOUNT,
      reblog: null,
      quote: null,
      in_reply_to_id: null,
      replies_count: 0,
      reblogs_count: 0,
      favourites_count: 0,
      favourited: false,
      reblogged: false,
      bookmarked: false,
      muted: false,
      pinned: false,
      sensitive: false,
      poll: null,
      quote_approval_policy: null,
      language: item.language,
      media_attachments: [],
      application: { name: this.label, website: SITE },
    };
  }
}
