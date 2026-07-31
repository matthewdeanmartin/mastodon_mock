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
 * ## The CORS situation
 *
 * is.gd *is* browser-callable: its create endpoint answers with
 * `Access-Control-Allow-Origin: *`. This file previously claimed the opposite,
 * and the claim was self-inflicted — the transport used to attach
 * `Accept: application/json` to every request, which forced a preflight, and
 * is.gd's `OPTIONS` reply carries no `Access-Control-Allow-Headers`. The GET was
 * therefore never sent, and the browser reported "ACAO missing" with
 * `Status code: 200`, which reads like a server-side CORS refusal but is really a
 * failed preflight.
 *
 * Hence `simpleRequest: true` below: no `Accept` header, no preflight, and the
 * response's `ACAO: *` is all that is needed. `format=json` in the query string
 * already selects JSON, so the header was buying nothing.
 *
 * A proxy is still the fallback if a direct call fails for some other reason
 * (offline, DNS, an ad-blocker) — the browser reports all of those identically as
 * `status: 0`, so the app cannot tell them apart and simply tries the proxy next.
 * That fallback is a small ask here: the request carries no credential, so
 * {@link ShortenerTransport} uses the *ordinary* proxy path with no consent
 * dialog. There is no key to steal, and the destination is a URL the user is
 * about to publish anyway.
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
        // No `Accept` header, so the browser skips the preflight is.gd cannot
        // satisfy. See the CORS note at the top of this file.
        simpleRequest: true,
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
