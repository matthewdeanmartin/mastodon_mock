import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../api';
import { ClientPrefs } from '../../client-prefs';
import { Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { HumanTimePipe } from '../../human-time.pipe';
import { readerChain } from './reader-chain';
import { BlueskyApi } from '../../providers/bluesky/bluesky-api';
import { adaptPost } from '../../providers/bluesky/bluesky-adapter';
import { BskyThreadNode } from '../../providers/bluesky/bluesky-types';

@Component({
  selector: 'app-thread',
  imports: [StatusCard, Compose, HumanTimePipe],
  templateUrl: './thread.html',
  styleUrl: './thread.css',
})
export class Thread implements OnInit {
  private api = inject(Api);
  private bsky = inject(BlueskyApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected readonly prefs = inject(ClientPrefs);

  protected status = signal<Status | null>(null);
  protected ancestors = signal<Status[]>([]);
  protected descendants = signal<Status[]>([]);
  protected loading = signal(true);

  /** Reader mode: distraction-free article view of the author's own chain. */
  protected readerMode = signal(false);

  /** The whole thread in display order. */
  private thread = computed<Status[]>(() => {
    const s = this.status();
    return s ? [...this.ancestors(), s, ...this.descendants()] : [];
  });

  /** The author chain reader mode renders (root post + same-author self-replies). */
  protected chain = computed<Status[]>(() => readerChain(this.thread()));

  /** Everything in the thread that is not part of the author chain: the comments. */
  protected comments = computed<Status[]>(() => {
    const chainIds = new Set(this.chain().map((s) => s.id));
    return this.thread().filter((s) => !chainIds.has(s.id));
  });

  /** Id of the chain post whose inline reply composer is open (reader mode). */
  protected replyingTo = signal<string | null>(null);

  toggleReaderReply(id: string): void {
    this.replyingTo.update((current) => (current === id ? null : id));
  }

  onReaderReplied(status: Status): void {
    this.replyingTo.set(null);
    this.onReply(status);
  }

  /** Patch a status wherever it lives (focused post, ancestors, or descendants). */
  patch(updated: Status): void {
    if (this.status()?.id === updated.id) {
      this.status.set(updated);
    }
    this.onContextChanged(updated);
  }

  toggleFavourite(post: Status): void {
    const call = post.favourited ? this.api.unfavourite(post.id) : this.api.favourite(post.id);
    call.subscribe((updated) => this.patch(updated));
  }

  toggleReblog(post: Status): void {
    const call = post.reblogged ? this.api.unreblog(post.id) : this.api.reblog(post.id);
    call.subscribe((updated) => this.patch(updated.reblog ?? updated));
  }

  toggleBookmark(post: Status): void {
    const call = post.bookmarked ? this.api.unbookmark(post.id) : this.api.bookmark(post.id);
    call.subscribe((updated) => this.patch(updated));
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
    // Deep link: status cards link here with ?reader=1 to open straight into reader mode.
    this.route.queryParamMap.subscribe((params) => {
      this.readerMode.set(params.get('reader') === '1');
    });
  }

  load(id: string): void {
    this.loading.set(true);
    if (id.startsWith('bsky:')) {
      this.loadBsky(id.slice('bsky:'.length));
      return;
    }
    this.api.getStatus(id).subscribe((s) => {
      this.status.set(s);
      this.loading.set(false);
    });
    this.api.getContext(id).subscribe((ctx) => {
      this.ancestors.set(ctx.ancestors);
      this.descendants.set(ctx.descendants);
    });
  }

  /** Bluesky thread: `getPostThread` mapped onto the same ancestors/descendants shape. */
  private loadBsky(uri: string): void {
    this.bsky.getPostThread(uri).subscribe({
      next: ({ thread }) => {
        if (!thread.post) {
          this.loading.set(false);
          return;
        }
        this.status.set(adaptPost(thread.post));
        const ancestors: Status[] = [];
        for (let node = thread.parent; node; node = node.parent) {
          if (node.post) {
            ancestors.unshift(adaptPost(node.post));
          }
        }
        this.ancestors.set(ancestors);
        this.descendants.set(flattenReplies(thread.replies ?? []));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleReader(): void {
    this.readerMode.update((v) => !v);
  }

  bumpReaderFont(delta: number): void {
    this.prefs.setReaderFontSize(this.prefs.readerFontSize() + delta);
  }

  onReply(status: Status): void {
    this.descendants.update((d) => [...d, status]);
  }

  onChanged(updated: Status): void {
    this.status.set(updated);
  }

  onContextChanged(updated: Status): void {
    const patch = (list: Status[]) => list.map((s) => (s.id === updated.id ? updated : s));
    this.ancestors.update(patch);
    this.descendants.update(patch);
  }

  onContextDeleted(removed: Status): void {
    const drop = (list: Status[]) => list.filter((s) => s.id !== removed.id);
    this.ancestors.update(drop);
    this.descendants.update(drop);
  }

  /** The focused status was deleted: leave the thread. */
  onFocusedDeleted(): void {
    this.router.navigateByUrl('/home');
  }
}

/** Depth-first flatten of a bsky reply tree into Mastodon-style descendants order. */
function flattenReplies(nodes: BskyThreadNode[]): Status[] {
  const out: Status[] = [];
  for (const node of nodes) {
    if (node.post) {
      out.push(adaptPost(node.post));
    }
    if (node.replies?.length) {
      out.push(...flattenReplies(node.replies));
    }
  }
  return out;
}
