import { inject, Injectable } from '@angular/core';
import { map, Observable, throwError } from 'rxjs';
import { LinkProviderError, LinkProviderErrorCode, unsupported } from './shortener-errors';
import {
  CreateLinkInput,
  Page,
  ShortenerCapabilities,
  ShortenerProvider,
  ShortLink,
  assertValidDestination,
} from './shortener-provider';
import { ShortenerTransport } from './shortener-transport';

/**
 * is.gd.
 *
 * The simplest provider here by a wide margin, and deliberately so: no accounts
 * exist, so there is nothing to sign up for, nothing to store, and nothing that
 * can leak. You can create a link and that is the entire surface — is.gd has no
 * concept of "your" links, so listing, editing and deleting are not features it
 * withholds from free users, they do not exist for anyone.
 *
 * Every operation but create therefore returns `UNSUPPORTED_OPERATION`, and
 * {@link capabilities} reports the truth so the Links page renders is.gd rows
 * read-only rather than showing buttons that cannot work.
 *
 * ## The CORS caveat
 *
 * is.gd's create endpoint sends no `Access-Control-Allow-Origin`, so a browser
 * cannot call it directly — a fact already recorded in the comment at the top of
 * `providers/paste/tinyurl-provider.ts`, which is why TinyURL was chosen for the
 * message-link feature instead. In practice is.gd here needs the user's CORS
 * proxy.
 *
 * That is a much smaller ask than it is for the others: the request carries no
 * credential, so {@link ShortenerTransport} routes it through the *ordinary*
 * proxy path with no consent dialog. There is no key for a proxy operator to
 * steal, and the destination being shortened is a URL the user is about to
 * publish anyway.
 */

const CREATE_URL = 'https://is.gd/create.php';

interface IsgdResponse {
  shorturl?: string;
  errorcode?: number;
  errormessage?: string;
}

/**
 * is.gd answers `200` with an error body rather than an HTTP error status, so
 * failures are detected by shape, not by code. Its documented error codes:
 * 1 = bad URL, 2 = bad custom slug (taken or invalid), 3 = rate limited,
 * 4 = service problem.
 */
function codeFor(errorcode: number | undefined): LinkProviderErrorCode {
  switch (errorcode) {
    case 1:
      return 'INVALID_DESTINATION';
    case 2:
      return 'SLUG_CONFLICT';
    case 3:
      return 'RATE_LIMITED';
    case 4:
      return 'PROVIDER_UNAVAILABLE';
    default:
      return 'UNKNOWN';
  }
}

@Injectable({ providedIn: 'root' })
export class IsgdProvider implements ShortenerProvider {
  private transport = inject(ShortenerTransport);

  readonly id = 'isgd' as const;
  readonly label = 'is.gd';

  capabilities(): ShortenerCapabilities {
    return {
      // A custom slug is the one option is.gd does offer anonymously.
      customSlug: true,
      customDomain: false,
      title: false,
      description: false,
      tags: false,
      expiry: false,
      password: false,
      archive: false,
      // Not "not implemented" — is.gd has no notion of link ownership at all.
      update: false,
      delete: false,
      textSearch: false,
      list: false,
    };
  }

  createLink(input: CreateLinkInput): Observable<ShortLink> {
    assertValidDestination(input.destinationUrl);
    const params = new URLSearchParams({
      format: 'json',
      url: input.destinationUrl,
    });
    if (input.slug) {
      params.set('shorturl', input.slug);
    }

    return this.transport
      .request<IsgdResponse>(this.id, {
        method: 'GET',
        url: `${CREATE_URL}?${params.toString()}`,
        idempotent: false,
      })
      .pipe(
        map((response) => {
          // A 200 with an error body is the normal failure shape here.
          if (!response?.shorturl) {
            throw new LinkProviderError(
              codeFor(response?.errorcode),
              response?.errormessage || 'is.gd could not shorten that link.',
              this.id,
            );
          }
          const shortUrl = response.shorturl;
          const slug = shortUrl.replace(/^https?:\/\/is\.gd\//i, '');
          return {
            provider: this.id,
            // No server-side identity exists; the slug is all there is, and
            // nothing can be done with it afterwards.
            providerId: slug,
            shortUrl,
            destinationUrl: input.destinationUrl,
            slug,
            domain: 'is.gd',
            raw: response,
          } satisfies ShortLink;
        }),
      );
  }

  updateLink(): Observable<ShortLink> {
    return throwError(() =>
      unsupported(this.id, 'is.gd links are anonymous and permanent — they cannot be edited.'),
    );
  }

  deleteLink(): Observable<void> {
    return throwError(() =>
      unsupported(this.id, 'is.gd links are anonymous and permanent — they cannot be deleted.'),
    );
  }

  getLink(): Observable<ShortLink> {
    return throwError(() =>
      unsupported(this.id, 'is.gd has no API for looking up a link you created.'),
    );
  }

  listLinks(): Observable<Page<ShortLink>> {
    return throwError(() =>
      unsupported(
        this.id,
        'is.gd has no accounts, so it cannot list your links. Mawkingbird shows the ones it made from this browser.',
      ),
    );
  }

  /**
   * Nothing to verify: there is no credential and no account.
   *
   * Reported as success so the connector page can mark is.gd usable without
   * firing a request — the only call it could make is a create, which would
   * leave a junk link behind every time the page was opened.
   */
  verify(): Observable<void> {
    return new Observable<void>((subscriber) => {
      subscriber.next();
      subscriber.complete();
    });
  }
}
