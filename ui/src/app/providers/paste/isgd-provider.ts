import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { Account, Status } from '../../models';
import { externalFetch } from '../external-fetch';
import { PasteCreateInput, PasteCreated, PasteProvider, PasteRecentItem } from './paste-provider';
import { buildMessageUrl } from './message-payload';

// is.gd and v.gd are the same service under two domains. is.gd is primary; if a
// create fails (e.g. its per-IP anti-abuse throttle), we retry once on v.gd.
const PRIMARY = { host: 'is.gd', base: 'https://is.gd' };
const FALLBACK = { host: 'v.gd', base: 'https://v.gd' };

const ISGD_ACCOUNT: Account = {
  id: 'paste:isgd',
  username: 'is.gd',
  acct: 'shortener@is.gd',
  display_name: 'is.gd short link',
  note: 'A message stored inside an is.gd short link. Anyone with the link can read it.',
  url: PRIMARY.base,
  avatar: `${PRIMARY.base}/favicon.ico`,
  avatar_static: `${PRIMARY.base}/favicon.ico`,
  header: '',
  followers_count: 0,
  following_count: 0,
  statuses_count: 0,
  bot: false,
  locked: false,
  discoverable: false,
  fields: [],
};

interface IsgdCreateResponse {
  shorturl?: string;
  errorcode?: number;
  errormessage?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The short code at the end of an is.gd/v.gd URL (e.g. "q7x9eD"). */
function slugOf(shortUrl: string): string {
  return new URL(shortUrl).pathname.replace(/^\/|\/$/g, '');
}

/**
 * A message published as an is.gd short link.
 *
 * The link shortener stores a redirect *target*, so we put the message inside
 * that target: a mawkingbird.com/message/ URL carrying the post fields. Opening
 * the short link lands on that reader page, which rebuilds a Mastodon status.
 * is.gd links are permanent and public, so this provider offers no edit, delete,
 * expiry, or public feed.
 */
@Injectable({ providedIn: 'root' })
export class IsgdProvider implements PasteProvider {
  private http = inject(HttpClient);

  readonly id = 'isgd';
  readonly label = 'is.gd link';
  readonly languages = [{ value: 'plaintext', label: 'Plain text' }] as const;
  readonly expiries = [{ value: 'never', label: 'Permanent (is.gd links never expire)' }] as const;
  readonly visibilities = ['unlisted'] as const;

  create(input: PasteCreateInput): Observable<PasteCreated> {
    const target = buildMessageUrl(input);
    return this.shorten(PRIMARY, target).pipe(
      catchError(() => this.shorten(FALLBACK, target)),
      map((shortUrl) => ({
        slug: slugOf(shortUrl),
        url: shortUrl,
        rawUrl: target,
        // is.gd has no per-link edit credential; the link is immutable.
        editKey: '',
      })),
    );
  }

  update(
    _slug: string,
    _editKey: string,
    _input: Pick<PasteCreateInput, 'title' | 'content' | 'language'>,
  ): Observable<void> {
    return throwError(
      () => new Error('is.gd links are permanent and cannot be edited. Create a new one instead.'),
    );
  }

  delete(_slug: string, _editKey: string): Observable<void> {
    return throwError(
      () => new Error('is.gd links are permanent and cannot be deleted from the service.'),
    );
  }

  status(item: PasteRecentItem): Status {
    return {
      provider: 'paste',
      providerRef: { providerId: this.id, slug: item.slug },
      id: `paste:${this.id}:${item.slug}`,
      created_at: item.createdAt,
      edited_at: null,
      content: escapeHtml(item.preview),
      spoiler_text: '',
      visibility: 'unlisted',
      url: item.url,
      account: ISGD_ACCOUNT,
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
      language: 'plaintext',
      media_attachments: [],
      application: { name: this.label, website: PRIMARY.base },
    };
  }

  private shorten(service: { base: string }, target: string): Observable<string> {
    const params = new HttpParams()
      .set('format', 'json')
      .set('logstats', '0')
      .set('url', target);
    return this.http
      .get<IsgdCreateResponse>(`${service.base}/create.php`, {
        params,
        context: externalFetch(),
      })
      .pipe(
        map((response) => {
          if (!response.shorturl) {
            throw new Error(
              response.errormessage ||
                'The link shortener rejected the request. It may be rate-limited — try again in a minute.',
            );
          }
          return response.shorturl;
        }),
      );
  }
}
