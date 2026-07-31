import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, throwError } from 'rxjs';
import { Account, Status } from '../../models';
import { externalFetch } from '../external-fetch';
import { CentosPasteKey } from './centos-key';
import { PasteFeedFetch } from './paste-feed-fetch';
import { PasteFeedSubscriptions } from './paste-feed-subscriptions';
import {
  FeedPasteProvider,
  PasteCreateInput,
  PasteCreated,
  PasteRecentItem,
} from './paste-provider';

const SITE = 'https://paste.centos.org';
const API = `${SITE}/api`;
const FEED_URL = `${API}/recent`;

const CENTOS_ACCOUNT: Account = {
  id: 'paste:centos',
  username: 'recent',
  acct: 'recent@paste.centos.org',
  display_name: 'CentOS Pastebin',
  note: 'Recent public pastes from the CentOS pastebin service.',
  url: SITE,
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

/** One entry of Stikked's `GET /api/recent`. */
interface StikkedRecentPaste {
  title?: string | null;
  name?: string | null;
  created?: string | number | null;
  lang?: string | null;
  url?: string | null;
  raw?: string | null;
  id?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Stikked reports creation time as a unix timestamp (seconds), sometimes as a
 * string. Anything unparseable falls back to "now" rather than emitting an
 * Invalid Date, which would sort the whole feed to the top of the timeline.
 */
function toIso(created: string | number | null | undefined): string {
  if (created === null || created === undefined || created === '') {
    return new Date().toISOString();
  }
  const seconds = typeof created === 'number' ? created : Number(created);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  const parsed = Date.parse(String(created));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

/** The trailing segment of a paste URL, used as its slug. */
function slugOf(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/**
 * paste.centos.org — a Stikked instance that gates *everything* behind an API key.
 *
 * Unlike every other provider here, there is no anonymous mode to fall back to:
 * `/api/recent` and `/api/create` both answer a bare `Invalid API key`, so
 * without a key this provider is inert and says so. The key is set on the Pastes
 * page and stored globally by {@link CentosPasteKey} — it authorises the browser
 * to talk to a pastebin, not a persona — while *subscribing* to the feed stays
 * per-account like every other feed.
 *
 * The host sends no CORS header, so reads also need the user's CORS proxy,
 * opted in per feed (see {@link PasteFeedFetch}). Creating a paste is a plain
 * form POST and is left direct: it would only be reachable through a proxy the
 * user opted a *feed* into, and silently routing a write — with the API key in
 * it — through a third party is exactly what the per-feed opt-in exists to
 * prevent.
 */
@Injectable({ providedIn: 'root' })
export class CentosProvider implements FeedPasteProvider {
  private http = inject(HttpClient);
  private feedFetch = inject(PasteFeedFetch);
  private subscriptions = inject(PasteFeedSubscriptions);
  private apiKey = inject(CentosPasteKey);

  readonly id = 'centos';
  readonly label = 'CentOS Pastebin';
  readonly feedUrl = FEED_URL;
  /** Stikked's API creates pastes but exposes no edit or delete. */
  readonly immutable = true;
  readonly visibilities = ['public', 'unlisted'] as const;
  readonly languages = [
    { value: 'text', label: 'Plain text' },
    { value: 'bash', label: 'Bash' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
    { value: 'css', label: 'CSS' },
    { value: 'diff', label: 'Diff' },
    { value: 'go', label: 'Go' },
    { value: 'html5', label: 'HTML' },
    { value: 'java', label: 'Java' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'json', label: 'JSON' },
    { value: 'lua', label: 'Lua' },
    { value: 'perl', label: 'Perl' },
    { value: 'php', label: 'PHP' },
    { value: 'python', label: 'Python' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'rust', label: 'Rust' },
    { value: 'sql', label: 'SQL' },
    { value: 'xml', label: 'XML' },
    { value: 'yaml', label: 'YAML' },
  ] as const;
  /** Stikked takes expiry in minutes; these are the buckets we offer. */
  readonly expiries = [
    { value: '10m', label: '10 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '1d', label: '1 day' },
    { value: '1w', label: '1 week' },
    { value: '1mo', label: '1 month' },
    { value: 'never', label: 'Never' },
  ] as const;

  /** True when a key is set, so the UI can explain why the feed is inert. */
  hasKey(): boolean {
    return this.apiKey.key() !== null;
  }

  private static readonly EXPIRY_MINUTES: Record<string, number> = {
    '10m': 10,
    '1h': 60,
    '1d': 1440,
    '1w': 10080,
    '1mo': 43200,
  };

  create(input: PasteCreateInput): Observable<PasteCreated> {
    const key = this.apiKey.key();
    if (!key) {
      return throwError(
        () =>
          new Error(
            'CentOS Pastebin needs an API key before it can be used. Add one on the Pastes page.',
          ),
      );
    }
    let body = new HttpParams()
      .set('apikey', key)
      .set('text', input.content)
      .set('lang', input.language || 'text');
    if (input.title.trim()) {
      body = body.set('title', input.title.trim());
    }
    if (input.visibility === 'unlisted') {
      body = body.set('private', '1');
    }
    const minutes = CentosProvider.EXPIRY_MINUTES[input.expiry];
    if (minutes) {
      body = body.set('expire', String(minutes));
    }

    return this.http
      .post(`${API}/create`, body.toString(), {
        context: externalFetch(),
        responseType: 'text',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      .pipe(
        map((response) => {
          // Stikked answers 200 with a bare URL on success and a bare error
          // string on failure — the status code does not distinguish them.
          const text = response.trim();
          if (!text.startsWith('http')) {
            throw new Error(text || 'CentOS Pastebin rejected the paste.');
          }
          const slug = slugOf(text);
          return {
            slug,
            url: text,
            rawUrl: `${SITE}/view/raw/${slug}`,
            // No edit key: Stikked has no edit or delete API (see `immutable`).
            editKey: '',
          };
        }),
      );
  }

  update(): Observable<void> {
    return throwError(() => new Error('CentOS pastes cannot be edited after posting.'));
  }

  delete(): Observable<void> {
    return throwError(() => new Error('CentOS pastes cannot be deleted after posting.'));
  }

  recent(): Observable<PasteRecentItem[]> {
    const key = this.apiKey.key();
    if (!key) {
      return throwError(
        () =>
          new Error(
            'CentOS Pastebin needs an API key to list recent pastes. Add one on the Pastes page.',
          ),
      );
    }
    const url = `${FEED_URL}?apikey=${encodeURIComponent(key)}`;
    return this.feedFetch
      .json<StikkedRecentPaste[]>(url, this.subscriptions.usesProxy(this.id), this.label)
      .pipe(
        map((pastes) => {
          if (!Array.isArray(pastes)) {
            // A rejected key comes back as the plain string "Invalid API key"
            // with a 200, so a non-array body is the signal to say so.
            throw new Error(
              `${this.label} refused the request — the API key may be wrong or expired.`,
            );
          }
          return pastes
            .filter((paste) => !!paste.url)
            .map((paste) => {
              const url = paste.url as string;
              return {
                slug: paste.id?.toString() || slugOf(url),
                title: paste.title?.trim() || null,
                language: paste.lang?.trim() || 'text',
                preview: paste.name?.trim() ? `Posted by ${paste.name.trim()}` : 'Public paste',
                createdAt: toIso(paste.created),
                url,
                rawUrl: paste.raw?.trim() || `${SITE}/view/raw/${slugOf(url)}`,
              };
            });
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
      account: CENTOS_ACCOUNT,
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
