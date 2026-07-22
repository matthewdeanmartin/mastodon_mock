import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../models';
import {
  SHARE_DESTINATIONS,
  ShareDialog,
  shareContext,
  shareableContentLinks,
} from './share-dialog';

function status(content = '<p>Hello world</p>'): Status {
  return {
    id: '1',
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content,
    spoiler_text: '',
    visibility: 'public',
    url: 'https://social.example/@alice/1',
    account: {
      id: 'a',
      username: 'alice',
      acct: 'alice@social.example',
      display_name: 'Alice',
      note: '',
      url: 'https://social.example/@alice',
      avatar: '',
      avatar_static: '',
      header: '',
      followers_count: 0,
      following_count: 0,
      statuses_count: 1,
      bot: false,
      locked: false,
      fields: [],
    },
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
    media_attachments: [],
  };
}

describe('ShareDialog', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ShareDialog] }));

  it('finds outbound links but not mentions, hashtags, or the post permalink', () => {
    const post = status(`
      <p>
        <a class="mention" href="https://social.example/@bob">@bob</a>
        <a class="hashtag" href="https://social.example/tags/news">#news</a>
        <a href="https://social.example/@alice/1">post</a>
        <a href="https://example.com/story">story</a>
        <a href="https://example.com/story">same story</a>
      </p>`);

    expect(shareableContentLinks(post)).toEqual(['https://example.com/story']);
  });

  it('builds encoded destination URLs and preserves the full Bluesky target URL', () => {
    const context = shareContext(status('<p>A useful story</p>'), 'https://example.com/a?x=1');
    const reddit = new URL(
      SHARE_DESTINATIONS.find((item) => item.id === 'reddit')!.buildUrl(context),
    );
    const bluesky = new URL(
      SHARE_DESTINATIONS.find((item) => item.id === 'bluesky')!.buildUrl(context),
    );

    expect(reddit.searchParams.get('url')).toBe('https://example.com/a?x=1');
    expect(reddit.searchParams.get('title')).toBe('Post by @alice@social.example');
    expect(bluesky.searchParams.get('text')).toContain('https://example.com/a?x=1');
  });

  it('offers wrapper removal only when the post contains an outbound link', () => {
    const withoutLink = TestBed.createComponent(ShareDialog);
    withoutLink.componentRef.setInput('status', status());
    withoutLink.detectChanges();
    expect(withoutLink.nativeElement.textContent).not.toContain('without the post wrapper');

    const withLink = TestBed.createComponent(ShareDialog);
    withLink.componentRef.setInput(
      'status',
      status('<p>Read <a href="https://example.com/story">this</a></p>'),
    );
    withLink.detectChanges();
    expect(withLink.nativeElement.textContent).toContain('without the post wrapper');
  });

  it('opens the chosen service with the linked page instead of the post wrapper', () => {
    const fixture = TestBed.createComponent(ShareDialog);
    fixture.componentRef.setInput(
      'status',
      status('<p>Read <a href="https://example.com/story">this</a></p>'),
    );
    fixture.detectChanges();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const element = fixture.nativeElement as HTMLElement;
    const linkedPage = element.querySelectorAll<HTMLInputElement>('input[name="share-target"]')[1];
    linkedPage.click();
    element.querySelectorAll<HTMLButtonElement>('.destination')[0].click();

    const opened = new URL(String(open.mock.calls[0][0]));
    expect(opened.searchParams.get('url')).toBe('https://example.com/story');
    open.mockRestore();
  });
});
