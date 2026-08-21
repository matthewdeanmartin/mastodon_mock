import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PageDiagnostics } from '../../page-diagnostics';
import { CorsProxy } from '../cors-proxy/cors-proxy';
import { externalFetch } from '../external-fetch';
import { ArticleCache } from './article-cache';
import { inspectUrl } from './article-diagnosis';
import { extractArticle } from './article-extract';
import { ArticleDiagnosis, ArticleResult } from './article-models';

/**
 * Fetches a remote page and turns it into something the reader can show.
 *
 * The one thing the UI talks to. Everything sharp lives behind it: the proxy,
 * the cache, the extractor, and the decision not to bother.
 *
 * ## Quota is deliberately not enforced here
 *
 * {@link ArticleQuota} is checked and consumed by the *caller*, after a result
 * comes back, because only the caller knows whether an article was actually
 * rendered. Doing it here would charge for cache hits and for failures, which
 * is exactly what makes a metered feature feel dishonest.
 */

/** The header the proxy uses to report where a redirect chain ended. */
const FINAL_URL_HEADER = 'X-Proxy-Final-Url';

/** Map a transport failure onto something the reader can explain. */
function diagnoseHttpError(error: HttpErrorResponse): ArticleDiagnosis {
  if (error.status === 429) {
    return 'rate-limited';
  }
  if (error.status === 403 || error.status === 401) {
    return 'bot-check';
  }
  if (error.status === 502 || error.status === 504) {
    // The proxy's own refusals arrive as 502 with a sentence saying why. The
    // two worth distinguishing are the ones a reader can act on.
    const detail = typeof error.error === 'string' ? error.error : '';
    if (/redirected more than/i.test(detail)) {
      return 'redirect-loop';
    }
    if (/over this route's|byte limit/i.test(detail)) {
      return 'too-large';
    }
    return 'network';
  }
  if (error.status === 415) {
    return 'not-html';
  }
  return 'network';
}

@Injectable({ providedIn: 'root' })
export class ArticleFetch {
  private http = inject(HttpClient);
  private proxy = inject(CorsProxy);
  private cache = inject(ArticleCache);
  private diagnostics = inject(PageDiagnostics);

  /** Whether expansion can be offered at all. */
  available(): boolean {
    return this.proxy.available();
  }

  /**
   * Expand one URL.
   *
   * Always resolves — never rejects — because every failure mode here is one
   * the reader is expected to show rather than one to handle. A caller reads
   * {@link ArticleResult.diagnosis} to find out what happened.
   *
   * @param force skip the cache, for an explicit "re-fetch".
   */
  async expand(url: string, force = false): Promise<ArticleResult> {
    const empty = (diagnosis: ArticleDiagnosis): ArticleResult => ({
      requestedUrl: url,
      finalUrl: url,
      card: null,
      article: null,
      diagnosis,
      fetchedAt: new Date().toISOString(),
    });

    // Tier 0: refuse what cannot work, before spending a request on it.
    const urlVerdict = inspectUrl(url);
    if (urlVerdict && !urlVerdict.worthTrying) {
      return empty(urlVerdict.diagnosis);
    }

    if (!force) {
      const cached = await this.cache.get(url);
      if (cached) {
        this.diagnostics.info('Article', 'cache hit', { url, diagnosis: cached.diagnosis });
        return cached;
      }
    }

    if (!this.proxy.available()) {
      return empty('network');
    }

    let html: string;
    let finalUrl: string;
    try {
      const request = this.proxy.proxyRequest(url, 'feeds');
      const response = await this.http
        .get(request.url, {
          headers: request.headers,
          context: externalFetch(),
          responseType: 'text',
          observe: 'response',
        })
        .toPromise();

      if (!response?.body) {
        return empty('network');
      }
      html = response.body;

      // Where the bytes actually came from, when the proxy followed a
      // redirect. Everything relative in the body resolves against this, so
      // getting it wrong breaks every image on a shortened link.
      finalUrl = response.headers.get(FINAL_URL_HEADER) ?? url;
    } catch (error) {
      const diagnosis = error instanceof HttpErrorResponse ? diagnoseHttpError(error) : 'network';
      this.diagnostics.info('Article', 'fetch failed', { url, diagnosis });
      const result = empty(diagnosis);
      await this.cache.put(url, result);
      return result;
    }

    const result = extractArticle(html, finalUrl, url);
    this.diagnostics.info('Article', 'extracted', {
      url,
      diagnosis: result.diagnosis,
      words: result.article?.metrics.wordCount ?? 0,
    });
    await this.cache.put(url, result);
    return result;
  }

  /** Drop a cached article so the next expand re-fetches it. */
  async forget(url: string): Promise<void> {
    await this.cache.remove(url);
  }
}
