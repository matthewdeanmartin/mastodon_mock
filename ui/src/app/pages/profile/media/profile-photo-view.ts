import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { FocusTrap } from '../../../a11y/focus-trap';
import { Compose } from '../../../compose/compose';
import { HumanTimePipe } from '../../../human-time.pipe';
import { RenderedHtmlLinks } from '../../../rendered-html-links';
import { TrustedAccounts } from '../../../trusted-accounts';
import { AnonymousPublicApi } from '../../../providers/anonymous/anonymous-public-api';
import { AnonymousPublicRef } from '../../../providers/anonymous/anonymous-route-ref';
import { accountRoutePath } from '../../../account-route';
import { Status } from '../../../models';
import { ProfileMediaItem } from './profile-media-item';

/**
 * The photo-first viewer behind a profile's media wall.
 *
 * Deliberately *not* the existing {@link ../../../lightbox/lightbox Lightbox},
 * which stays what it is: a utilitarian "embiggen this attachment" overlay for
 * the timeline. This one is for the case where the pictures are the point — the
 * image takes most of the page and the conversation about it sits alongside,
 * with the thread readable and a reply box under it.
 *
 * Navigation matches what the grid implies. Left/right walks every image in
 * order, exactly the sequence the eye follows across the wall; up/down jumps
 * whole posts, so a four-photo album costs one keypress to skip rather than
 * four.
 */
@Component({
  selector: 'app-profile-photo-view',
  imports: [FocusTrap, RouterLink, HumanTimePipe, RenderedHtmlLinks, Compose],
  templateUrl: './profile-photo-view.html',
  styleUrl: './profile-photo-view.css',
})
export class ProfilePhotoView {
  private api = inject(Api);
  private anonymousPublic = inject(AnonymousPublicApi);
  private trusted = inject(TrustedAccounts);
  private router = inject(Router);
  protected auth = inject(Auth);

  /** Every image on the wall, so the viewer can page within it. */
  readonly items = input.required<ProfileMediaItem[]>();
  /** The `?photo=` key currently open. */
  readonly activeKey = input.required<string>();
  /** Set for cross-instance anonymous profiles; replies are read through it. */
  readonly publicRef = input<AnonymousPublicRef | null>(null);

  readonly closed = output<void>();
  /** Asks the parent to move to another image (it owns the URL). */
  readonly navigated = output<ProfileMediaItem>();
  /** The reader hit the end of what is loaded and more may exist. */
  readonly wantMore = output<void>();

  protected current = computed(
    () => this.items().find((item) => item.key === this.activeKey()) ?? null,
  );

  protected index = computed(() => this.items().findIndex((i) => i.key === this.activeKey()));

  /** Position within the whole wall, for the "3 of 40" counter. */
  protected position = computed(() => this.index() + 1);
  protected total = computed(() => this.items().length);

  /**
   * Sensitive images stay blurred here too.
   *
   * Reaching the viewer does not imply consent to see the picture: a reader can
   * arrive by arrowing along the wall, or by opening a link somebody sent them.
   */
  private revealed = signal<Set<string>>(new Set());

  protected blurred = computed(() => {
    const item = this.current();
    if (!item || this.revealed().has(item.key)) {
      return false;
    }
    this.trusted.entries();
    return item.status.sensitive && !this.trusted.sensitiveShown(item.status.account);
  });

  protected reveal(): void {
    const item = this.current();
    if (item) {
      this.revealed.update((set) => new Set(set).add(item.key));
    }
  }

  // --- the conversation column ---

  protected replies = signal<Status[]>([]);
  protected repliesLoading = signal(false);
  protected repliesError = signal<string | null>(null);
  private contextSub = new Subscription();

  /**
   * Whether this post can be replied to at all.
   *
   * RSS items, scraped Twitter posts and pastes have no reply endpoint —
   * there is nothing on the other end to receive one. The column still shows
   * the caption and says so, rather than offering a box that cannot work.
   */
  protected canReply = computed(() => {
    const status = this.current()?.status;
    if (!status || this.auth.isAnonymous) {
      return false;
    }
    const provider = status.provider;
    return !provider || provider === 'mastodon';
  });

  /** Why the reply box is absent, phrased for the specific source. */
  protected replyUnavailableReason = computed(() => {
    const status = this.current()?.status;
    if (!status) {
      return '';
    }
    if (this.auth.isAnonymous) {
      return 'Sign in to reply.';
    }
    switch (status.provider) {
      case 'rss':
      case 'blog':
        return 'This is a blog post from a feed — reply on the original site.';
      case 'twitter':
        return 'Replies are not available for Twitter posts here.';
      case 'bluesky':
        return 'Replying to Bluesky posts is not supported from this view yet.';
      case 'paste':
        return 'This item has no comment thread.';
      default:
        return 'Replies are not available for this post.';
    }
  });

  /** The handle a reply should mention so the author is actually notified. */
  protected replyToHandle = computed(() => this.current()?.status.account.acct ?? '');

  constructor() {
    // Re-read the thread whenever the open picture moves to a different *post*.
    // Paging between two images of the same album must not refetch: it is the
    // same conversation, and a flicker there would be pure noise.
    effect(() => {
      const status = this.current()?.status;
      if (!status) {
        return;
      }
      this.loadContext(status);
    });
  }

  private lastContextStatusId: string | null = null;

  private loadContext(status: Status): void {
    if (this.lastContextStatusId === status.id) {
      return;
    }
    this.lastContextStatusId = status.id;
    this.contextSub.unsubscribe();
    this.contextSub = new Subscription();
    this.replies.set([]);
    this.repliesError.set(null);

    // Only Mastodon has a context endpoint. Everything else shows its caption
    // alone, which is the honest rendering of "this source has no thread".
    const provider = status.provider;
    const isMastodon = !provider || provider === 'mastodon' || provider === 'anonymous-mastodon';
    if (!isMastodon) {
      return;
    }

    this.repliesLoading.set(true);
    const ref = this.publicRef();
    const request =
      ref && provider === 'anonymous-mastodon'
        ? this.anonymousPublic.getContext({ ...ref, id: this.nativeId(status) })
        : this.api.getContext(status.id);
    this.contextSub.add(
      request.subscribe({
        next: (context) => {
          this.replies.set(context.descendants ?? []);
          this.repliesLoading.set(false);
        },
        error: () => {
          this.repliesLoading.set(false);
          this.repliesError.set('Could not load the comments.');
        },
      }),
    );
  }

  /** The id the *origin* server knows this status by, for cross-instance reads. */
  private nativeId(status: Status): string {
    const ref = status.providerRef as { statusId?: string } | undefined;
    return typeof ref?.statusId === 'string' ? ref.statusId : status.id;
  }

  /** A posted reply lands at the bottom of the thread without a refetch. */
  protected onReplied(reply: Status): void {
    this.replies.update((list) => [...list, reply]);
  }

  // --- navigation ---

  protected go(delta: number): void {
    const items = this.items();
    const at = this.index();
    if (at < 0) {
      return;
    }
    const next = at + delta;
    if (next < 0) {
      return;
    }
    if (next >= items.length) {
      // Off the end of what is loaded: ask for another page rather than
      // wrapping. Wrapping would quietly send the reader back to the newest
      // picture, which reads as "the app lost my place".
      this.wantMore.emit();
      return;
    }
    this.navigated.emit(items[next]);
  }

  /**
   * Jump to the first image of the adjacent *post*.
   *
   * This is the answer to "four presses to get past an album": the grid is a
   * flat wall of images, but the underlying posts are still the unit a reader
   * thinks in when they want to move on.
   */
  protected goPost(delta: number): void {
    const items = this.items();
    const item = this.current();
    if (!item) {
      return;
    }
    const targetPost = item.postIndex + delta;
    if (targetPost < 0) {
      return;
    }
    const target = items.find((candidate) => candidate.postIndex === targetPost);
    if (!target) {
      if (delta > 0) {
        this.wantMore.emit();
      }
      return;
    }
    this.navigated.emit(target);
  }

  protected hasPrev = computed(() => this.index() > 0);
  protected hasNext = computed(() => this.index() >= 0 && this.index() < this.items().length - 1);

  protected close(): void {
    this.closed.emit();
  }

  /** Close when the backdrop itself is clicked, never the photo or the column. */
  protected onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  protected authorLink = computed(() => {
    const account = this.current()?.status.account;
    return account ? accountRoutePath({ id: account.id, handle: account.acct }) : ['/'];
  });

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    // Never steal keys from the reply box: arrowing through a draft must move
    // the caret, not the picture.
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) {
      return;
    }
    if (target?.isContentEditable) {
      return;
    }
    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.go(1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.go(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.goPost(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.goPost(-1);
        break;
    }
  }
}
