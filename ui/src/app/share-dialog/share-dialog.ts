import { Component, computed, input, output, signal } from '@angular/core';
import { Status } from '../models';

export interface ShareContext {
  url: string;
  title: string;
  text: string;
}

export interface ShareDestination {
  id: string;
  label: string;
  buildUrl(context: ShareContext): string;
}

function plainText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function shortened(text: string, maximum: number): string {
  const characters = Array.from(text);
  return characters.length <= maximum ? text : `${characters.slice(0, maximum - 1).join('')}…`;
}

function urlWithParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/** Ordinary outbound links in a post, excluding mentions, hashtags, and the post permalink. */
export function shareableContentLinks(status: Status): string[] {
  const document = new DOMParser().parseFromString(status.content, 'text/html');
  let ownUrl: string | null = null;
  try {
    ownUrl = status.url ? new URL(status.url).toString() : null;
  } catch {
    // A malformed status URL cannot equal a valid outbound URL.
  }
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .filter(
      (anchor) => !anchor.classList.contains('mention') && !anchor.classList.contains('hashtag'),
    )
    .map((anchor) => {
      try {
        const url = new URL(anchor.getAttribute('href')!);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
      } catch {
        return null;
      }
    })
    .filter((url): url is string => !!url && url !== ownUrl);
  return [...new Set(links)];
}

export function shareContext(status: Status, url: string): ShareContext {
  const account = status.account.acct || status.account.username;
  const text = plainText(status.content);
  return {
    url,
    title: `Post by @${account}`,
    text: shortened(text ? `From @${account}: ${text}` : `From @${account}`, 220),
  };
}

function blueskyText(text: string, url: string): string {
  const suffix = `\n\n${url}`;
  return `${shortened(text, Math.max(1, 300 - Array.from(suffix).length))}${suffix}`;
}

export const SHARE_DESTINATIONS: ShareDestination[] = [
  {
    id: 'reddit',
    label: 'Reddit',
    buildUrl: ({ url, title }) => urlWithParams('https://www.reddit.com/submit', { url, title }),
  },
  {
    id: 'bluesky',
    label: 'Bluesky',
    buildUrl: ({ url, text }) =>
      urlWithParams('https://bsky.app/intent/compose', {
        text: blueskyText(text, url),
      }),
  },
  {
    id: 'tumblr',
    label: 'Tumblr',
    buildUrl: ({ url, title, text }) =>
      urlWithParams('https://www.tumblr.com/widgets/share/tool', {
        canonicalUrl: url,
        title,
        caption: text,
      }),
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    buildUrl: ({ url }) =>
      urlWithParams('https://www.linkedin.com/sharing/share-offsite/', { url }),
  },
  {
    id: 'hacker-news',
    label: 'Hacker News',
    buildUrl: ({ url, title }) =>
      urlWithParams('https://news.ycombinator.com/submitlink', { u: url, t: title }),
  },
];

@Component({
  selector: 'app-share-dialog',
  templateUrl: './share-dialog.html',
  styleUrl: './share-dialog.css',
})
export class ShareDialog {
  readonly status = input.required<Status>();
  readonly closed = output<void>();

  protected readonly destinations = SHARE_DESTINATIONS;
  protected readonly contentLinks = computed(() => shareableContentLinks(this.status()));
  protected selectedUrl = signal('');
  protected copied = signal(false);
  protected copyFailed = signal(false);
  protected readonly canShareUsingDevice = typeof navigator.share === 'function';

  protected targetUrl(): string {
    return this.selectedUrl() || this.status().url || '';
  }

  protected host(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  protected open(destination: ShareDestination): void {
    const url = destination.buildUrl(shareContext(this.status(), this.targetUrl()));
    window.open(url, '_blank', 'noopener,noreferrer');
    this.closed.emit();
  }

  protected async shareUsingDevice(): Promise<void> {
    const context = shareContext(this.status(), this.targetUrl());
    try {
      await navigator.share(context);
      this.closed.emit();
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') this.closed.emit();
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.targetUrl());
      this.copyFailed.set(false);
      this.copied.set(true);
    } catch {
      this.copyFailed.set(true);
      this.copied.set(false);
    }
  }
}
