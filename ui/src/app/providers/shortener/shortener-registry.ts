import { computed, inject, Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { PasteHistory } from '../paste/paste-history';
import { DubProvider } from './dub-provider';
import { ShortenerHistory, ShortLinkRecord, mergeLinks } from './shortener-history';
import {
  CreateLinkInput,
  LinkQuery,
  ShortenerProvider,
  ShortenerId,
  ShortLink,
  UpdateLinkInput,
} from './shortener-provider';
import { ShortenerSettings } from './shortener-settings';
import { ShortioProvider } from './shortio-provider';
import { TlyProvider } from './tly-provider';

/**
 * The shortening services this app can use, and which one is live.
 *
 * Mirrors {@link PasteProviderRegistry} in shape, with one deliberate
 * difference: the paste providers are all live at once, while exactly one
 * shortener is active. That is the spec's rule and it is the right one here —
 * "shorten this URL" has to have a single answer, whereas "post this paste"
 * sensibly asks where.
 */
@Injectable({ providedIn: 'root' })
export class ShortenerRegistry {
  private dub = inject(DubProvider);
  private shortio = inject(ShortioProvider);
  private tly = inject(TlyProvider);
  private settings = inject(ShortenerSettings);
  private history = inject(ShortenerHistory);
  private pastes = inject(PasteHistory);

  readonly all: readonly ShortenerProvider[] = [this.dub, this.shortio, this.tly];

  /** The provider in use, or null when none is configured well enough. */
  readonly active = computed<ShortenerProvider | null>(() => {
    const id = this.settings.activeId();
    return id && this.settings.usable() ? (this.get(id) ?? null) : null;
  });

  get(id: ShortenerId): ShortenerProvider | undefined {
    return this.all.find((provider) => provider.id === id);
  }

  /** Shorten a URL with the active provider, recording it locally. */
  create(input: CreateLinkInput): Observable<ShortLink> {
    const provider = this.require();
    return provider.createLink(input).pipe(
      map((link) => {
        this.history.add(link);
        return link;
      }),
    );
  }

  update(providerId: string, changes: UpdateLinkInput): Observable<ShortLink> {
    const provider = this.require();
    return provider.updateLink(providerId, changes).pipe(
      map((link) => {
        const { raw, ...rest } = link;
        void raw;
        this.history.update(provider.id, providerId, rest);
        return link;
      }),
    );
  }

  delete(providerId: string): Observable<void> {
    const provider = this.require();
    return provider.deleteLink(providerId).pipe(
      map(() => {
        this.history.remove(provider.id, providerId);
      }),
    );
  }

  /**
   * Every link worth showing on the Links page.
   *
   * Three sources, merged: the active provider's list API, this browser's
   * history for that provider, and the message-links created through the
   * pre-existing TinyURL shortener. The last is why this returns records rather
   * than {@link ShortLink} — TinyURL links have no provider-side identity at all
   * and exist only as local history.
   */
  list(query: LinkQuery = {}): Observable<ShortLinkRecord[]> {
    const provider = this.active();
    if (!provider) {
      return of(this.localOnly(query));
    }

    const local = this.history.forProvider(provider.id);
    return provider.listLinks(query).pipe(
      map((page) => {
        const merged = mergeLinks(page.items, local);
        // Providers without server-side text search get it applied here, over
        // the bounded page they returned. The spec is explicit that this must
        // never mean downloading the whole account to search it.
        const filtered = provider.capabilities.textSearch
          ? merged
          : filterLocally(merged, query.search);
        return [...filtered, ...this.tinyurlRecords(query.search)].sort((a, b) =>
          b.recordedAt.localeCompare(a.recordedAt),
        );
      }),
    );
  }

  /** The view when no provider is configured: local history and TinyURL only. */
  private localOnly(query: LinkQuery): ShortLinkRecord[] {
    return [
      ...filterLocally(this.history.records(), query.search),
      ...this.tinyurlRecords(query.search),
    ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  /**
   * TinyURL message-links, adapted into link records.
   *
   * These are created by the *paste* feature — a whole post encoded into a
   * redirect target — and they stay owned by it. The Links page shows them
   * because from the user's side they are short links they made and may want to
   * find again, which is exactly what this page is for. They are read-only here:
   * TinyURL has no edit or delete API, so the page renders no controls for them.
   */
  private tinyurlRecords(search?: string): ShortLinkRecord[] {
    const records = this.pastes
      .records()
      .filter((paste) => paste.providerId === 'tinyurl')
      .map<ShortLinkRecord>((paste) => ({
        provider: 'tinyurl',
        providerId: paste.slug,
        shortUrl: paste.url,
        destinationUrl: paste.rawUrl,
        slug: paste.slug,
        title: paste.title || undefined,
        recordedAt: paste.createdAt,
        // TinyURL links are permanent: no edit, no delete.
        readOnly: true,
      }));
    return filterLocally(records, search);
  }

  private require(): ShortenerProvider {
    const provider = this.active();
    if (!provider) {
      throw new Error(this.settings.blockedReason() ?? 'No link shortener is configured.');
    }
    return provider;
  }
}

/** Case-insensitive match across the fields a user would search by. */
function filterLocally(records: readonly ShortLinkRecord[], search?: string): ShortLinkRecord[] {
  const needle = search?.trim().toLowerCase();
  if (!needle) {
    return [...records];
  }
  return records.filter((record) =>
    [record.shortUrl, record.destinationUrl, record.slug, record.title, record.description]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(needle)),
  );
}
