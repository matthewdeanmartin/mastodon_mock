import { Directive, HostListener, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Extract a hashtag name from an anchor in server-rendered HTML, or null.
 *
 * Mastodon marks these with `class="… hashtag"` and an href ending in
 * `/tags/<name>`; the anchor's visible `#text` is the fallback for servers that
 * omit the class.
 */
export function hashtagNameFrom(anchor: HTMLAnchorElement, href: string): string | null {
  const isHashtag = anchor.classList.contains('hashtag') || /\/tags?\/[^/?#]+\/?$/i.test(href);
  if (!isHashtag) {
    return null;
  }
  const fromHref = href.match(/\/tags?\/([^/?#]+)\/?$/i)?.[1];
  const raw = fromHref ?? anchor.textContent ?? '';
  const name = decodeURIComponent(raw).replace(/^#/, '').trim();
  return name || null;
}

/**
 * Keep links inside server-rendered HTML on this site where we can.
 *
 * Server-rendered `note`/`content` HTML carries absolute URLs pointing at the
 * origin instance — a hashtag in a bio is `https://mastodon.social/tags/foo`,
 * not `/tags/foo`. Following one leaves Mawkingbird entirely and drops the
 * reader on a stranger's web UI, which is rarely what clicking a hashtag in
 * *this* app is meant to do.
 *
 * Rewriting the HTML itself would mean parsing and re-serializing every bio, so
 * this intercepts the click instead: hashtags route to the in-app tag page, and
 * anything else with an explicit origin opens in a new tab rather than
 * navigating this one away.
 *
 * Mentions are deliberately not handled here. Resolving one needs the status's
 * `mentions` array to map a URL onto a local account id, which a bio does not
 * carry — {@link StatusCard} keeps that logic because it is the only caller
 * that has the data.
 */
@Directive({
  selector: '[appRenderedHtmlLinks]',
})
export class RenderedHtmlLinks {
  private router = inject(Router);

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }
    const tag = hashtagNameFrom(anchor, href);
    if (tag) {
      event.preventDefault();
      event.stopPropagation();
      void this.router.navigate(['/tags', tag]);
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }
}
