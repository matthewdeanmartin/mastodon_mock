import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Account, Status } from '../../models';
import { externalFetch } from '../external-fetch';
import { PasteCreateInput, PasteCreated, PasteProvider, PasteRecentItem } from './paste-provider';

const API_URL = 'https://pastepile.com/api/public/pastes';

const PASTEPILE_ACCOUNT: Account = {
  id: 'paste:pastepile',
  username: 'recent',
  acct: 'recent@pastepile.com',
  display_name: 'Pastepile public feed',
  note: 'Recent public anonymous pastes from Pastepile.',
  url: 'https://pastepile.com/archive',
  avatar: 'https://pastepile.com/favicon.svg',
  avatar_static: 'https://pastepile.com/favicon.svg',
  header: '',
  followers_count: 0,
  following_count: 0,
  statuses_count: 0,
  bot: false,
  locked: false,
  discoverable: true,
  fields: [],
};

interface PastepileCreateResponse {
  slug: string;
  url: string;
  raw_url: string;
  edit_key: string;
}

interface PastepileRecentResponse {
  items: {
    slug: string;
    title: string | null;
    language: string;
    preview: string;
    created_at: string;
    url: string;
    raw_url: string;
  }[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

@Injectable({ providedIn: 'root' })
export class PastepileProvider implements PasteProvider {
  private http = inject(HttpClient);

  readonly id = 'pastepile';
  readonly label = 'Pastepile';
  readonly feedUrl = API_URL;
  readonly visibilities = ['public', 'unlisted'] as const;
  readonly languages = [
    { value: 'plaintext', label: 'Plain text' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'php', label: 'PHP' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
    { value: 'sql', label: 'SQL' },
    { value: 'json', label: 'JSON' },
    { value: 'yaml', label: 'YAML' },
    { value: 'bash', label: 'Bash' },
  ] as const;
  readonly expiries = [
    { value: '10m', label: '10 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '1d', label: '1 day' },
    { value: '1w', label: '1 week' },
    { value: '1mo', label: '1 month' },
    { value: 'burn', label: 'Burn after reading' },
  ] as const;

  create(input: PasteCreateInput): Observable<PasteCreated> {
    return this.http
      .post<PastepileCreateResponse>(
        API_URL,
        {
          title: input.title || undefined,
          content: input.content,
          language: input.language,
          expiry: input.expiry,
          visibility: input.visibility,
        },
        { context: externalFetch() },
      )
      .pipe(
        map((created) => ({
          slug: created.slug,
          url: created.url,
          rawUrl: created.raw_url,
          editKey: created.edit_key,
        })),
      );
  }

  update(
    slug: string,
    editKey: string,
    input: Pick<PasteCreateInput, 'title' | 'content' | 'language'>,
  ): Observable<void> {
    return this.http
      .patch(
        `${API_URL}/${encodeURIComponent(slug)}`,
        {
          title: input.title || null,
          content: input.content,
          language: input.language,
          edit_key: editKey,
        },
        { context: externalFetch() },
      )
      .pipe(map(() => undefined));
  }

  delete(slug: string, editKey: string): Observable<void> {
    return this.http
      .delete(`${API_URL}/${encodeURIComponent(slug)}`, {
        context: externalFetch(),
        headers: new HttpHeaders({ 'X-Edit-Key': editKey }),
      })
      .pipe(map(() => undefined));
  }

  recent(): Observable<PasteRecentItem[]> {
    return this.http
      .get<PastepileRecentResponse>(`${API_URL}?limit=50`, { context: externalFetch() })
      .pipe(
        map((response) =>
          response.items.map((item) => ({
            slug: item.slug,
            title: item.title,
            language: item.language,
            preview: item.preview,
            createdAt: item.created_at,
            url: item.url,
            rawUrl: item.raw_url,
          })),
        ),
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
      account: PASTEPILE_ACCOUNT,
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
      application: { name: this.label, website: 'https://pastepile.com' },
    };
  }
}
