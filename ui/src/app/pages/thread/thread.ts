import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Terminology } from '../../terminology';
import { ClientPrefs } from '../../client-prefs';
import { Account, Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { HumanTimePipe } from '../../human-time.pipe';
import { readerChain } from './reader-chain';
import { BlueskyApi } from '../../providers/bluesky/bluesky-api';
import { adaptPost } from '../../providers/bluesky/bluesky-adapter';
import { BskyThreadNode } from '../../providers/bluesky/bluesky-types';
import { BskyReply } from '../../providers/bluesky/bluesky-reply';
import { StatusActions } from '../../providers/status-actions';
import { RssProvider } from '../../providers/rss/rss-provider';
import { Subscription } from 'rxjs';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import {
  AnonymousPublicRef,
  parseAnonymousStatusRouteRef,
} from '../../providers/anonymous/anonymous-route-ref';
import { AnonymousBookmarks } from '../../providers/anonymous/anonymous-bookmarks';
import { ElizaService } from '../../eliza/eliza.service';
import { LocalPostStore } from '../../eliza/local-post-store';
import { LocalCompose } from '../../eliza/local-compose';
import { isElizaId } from '../../eliza/eliza-identity';

@Component({
  selector: 'app-thread',
  imports: [StatusCard, Compose, BskyReply, HumanTimePipe, RouterLink, LocalCompose],
  templateUrl: './thread.html',
  styleUrl: './thread.css',
})
export class Thread implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private bsky = inject(BlueskyApi);
  private rss = inject(RssProvider);
  private anonymousPublic = inject(AnonymousPublicApi);
  private anonymousBookmarks = inject(AnonymousBookmarks);
  private eliza = inject(ElizaService);
  private localPosts = inject(LocalPostStore);
  private actions = inject(StatusActions);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private loadSub = new Subscription();

  protected readonly prefs = inject(ClientPrefs);
  protected words = inject(Terminology).words;

  protected status = signal<Status | null>(null);
  protected ancestors = signal<Status[]>([]);
  protected descendants = signal<Status[]>([]);
  protected loading = signal(true);
  protected isAnonymousPublic = signal(false);
  protected publicContextUnavailable = signal(false);
  protected publicOriginalUrl = signal<string | null>(null);

  /** Reader mode: distraction-free article view of the author's own chain. */
  protected readerMode = signal(false);

  /** True while viewing an RSS article: interactions are read-only, comments come from a feed. */
  protected isRss = signal(false);
  /** Whether the RSS item declared a comment feed we could load (informs the empty state). */
  protected rssHasCommentFeed = signal(false);
  /** True once a declared RSS comment feed came back empty or failed to load. */
  protected rssCommentsUnavailable = signal(false);

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

  /**
   * The single other participant when this thread is a 1:1 conversation —
   * exactly the current user and one other person across every post in the
   * thread. Null for a solo thread, or the moment a third voice appears.
   *
   * The chat tab has no multi-person UI yet, and we don't want to make it easy
   * to stumble into a 20-way "chat" that reads badly — so "open in chat" is only
   * offered (and enabled) when it maps cleanly onto a two-person DM. Bluesky/RSS/
   * anonymous threads don't participate: those don't have a Mastodon DM to open.
   */
  protected chatPartner = computed(() => {
    if (this.isRss() || this.isAnonymousPublic()) {
      return null;
    }
    const me = this.auth.account();
    const posts = this.thread();
    if (!me || !posts.length) {
      return null;
    }
    // Bluesky posts route to a different DM system; if any post is bsky this
    // isn't a Mastodon 1:1 chat we can open here.
    if (posts.some((p) => this.isBluesky(p))) {
      return null;
    }
    const others = new Map<string, Account>();
    for (const p of posts) {
      const acc = p.account;
      if (acc.id !== me.id) {
        others.set(acc.id, acc);
      }
    }
    // Exactly one other voice → a clean two-person chat. Zero (a solo thread) or
    // two-plus (a group) both disqualify.
    return others.size === 1 ? [...others.values()][0] : null;
  });

  /** The conversations-tab key for a 1:1 chat, matching how public chats group
   *  by the other person (see notifications' `chatKey`). Null when not eligible. */
  protected chatKey = computed(() => {
    const partner = this.chatPartner();
    return partner ? `pub:${partner.acct}` : null;
  });

  /**
   * Query params for the "open in chat" link. `open` selects (or, on the chat
   * page, seeds) the 1:1 chat by its public key; `with` carries the partner's
   * account id so the chat page can fetch the full record and draft a fresh chat
   * even when no message history exists yet. Null when not eligible.
   */
  protected chatQueryParams = computed<Record<string, string> | null>(() => {
    const partner = this.chatPartner();
    const key = this.chatKey();
    return partner && key ? { open: key, with: partner.id } : null;
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
    this.actions.toggleFavourite(post).subscribe((updated) => this.patch(updated));
  }

  toggleReblog(post: Status): void {
    this.actions.toggleReblog(post).subscribe((updated) => this.patch(updated.reblog ?? updated));
  }

  toggleBookmark(post: Status): void {
    if (post.provider === 'anonymous-mastodon') {
      this.patch(this.anonymousBookmarks.toggle(post));
      return;
    }
    const call = post.bookmarked ? this.api.unbookmark(post.id) : this.api.bookmark(post.id);
    call.subscribe((updated) => this.patch(updated));
  }

  /** Latest route id and `?reader` value, tracked so either stream can recompute reader mode. */
  private currentId = '';
  private readerParam: string | null = null;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.currentId = id;
        this.applyReaderMode();
        this.load(id);
      }
    });
    // Deep link: status cards link here with ?reader=1 to open straight into
    // reader mode. RSS items are articles, so they default to reader ON unless
    // the link explicitly opts out with ?reader=0.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.readerParam = params.get('reader');
      this.applyReaderMode();
    });
  }

  private applyReaderMode(): void {
    const rssDefault = this.currentId.startsWith('rss:') && this.readerParam !== '0';
    this.readerMode.set(this.readerParam === '1' || rssDefault);
  }

  load(id: string): void {
    this.loadSub.unsubscribe();
    this.loadSub = new Subscription();
    this.loading.set(true);
    this.status.set(null);
    this.ancestors.set([]);
    this.descendants.set([]);
    this.isRss.set(false);
    this.isAnonymousPublic.set(false);
    this.publicContextUnavailable.set(false);
    this.publicOriginalUrl.set(null);
    this.rssHasCommentFeed.set(false);
    this.rssCommentsUnavailable.set(false);
    if (id.startsWith('bsky:')) {
      this.loadBsky(id.slice('bsky:'.length));
      return;
    }
    if (id.startsWith('rss:')) {
      this.loadRss(id);
      return;
    }
    if (isElizaId(id) || id.startsWith('local:')) {
      this.loadLocal(id);
      return;
    }
    const publicRef = parseAnonymousStatusRouteRef(id);
    if (publicRef) {
      this.loadAnonymousPublic(publicRef);
      return;
    }
    this.loadSub.add(
      this.api.getStatus(id).subscribe((s) => {
        this.status.set(s);
        this.loading.set(false);
      }),
    );
    this.loadSub.add(
      this.api.getContext(id).subscribe((ctx) => {
        this.ancestors.set(ctx.ancestors);
        this.descendants.set(ctx.descendants);
      }),
    );
  }

  /** Public Mastodon status and context; a blocked context endpoint never hides the post itself. */
  private loadAnonymousPublic(ref: AnonymousPublicRef): void {
    this.isAnonymousPublic.set(true);
    this.publicOriginalUrl.set(ref.originalUrl ?? null);
    this.loadSub.add(
      this.anonymousPublic.getStatus(ref).subscribe({
        next: (status) => {
          const saved = this.anonymousBookmarks.has(status);
          this.status.set(saved ? { ...status, bookmarked: true } : status);
          this.publicOriginalUrl.set(status.url ?? ref.originalUrl ?? null);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      }),
    );
    this.loadSub.add(
      this.anonymousPublic.getContext(ref).subscribe({
        next: (context) => {
          this.ancestors.set(context.ancestors);
          this.descendants.set(context.descendants);
        },
        error: () => this.publicContextUnavailable.set(true),
      }),
    );
  }

  /**
   * A browser-local practice thread: Eliza's posts and the viewer's own local
   * posts, assembled from the local stores with no network. Missing ids (e.g. a
   * stale link after unfollow cleared the feed) fall through to the empty state.
   */
  private loadLocal(id: string): void {
    this.localPosts.refresh();
    const thread = this.localPosts.thread(id, this.eliza.timeline());
    if (!thread) {
      this.loading.set(false);
      return;
    }
    this.status.set(thread.status);
    this.ancestors.set(thread.ancestors);
    this.descendants.set(thread.descendants);
    this.loading.set(false);
  }

  /** Bluesky thread: `getPostThread` mapped onto the same ancestors/descendants shape. */
  private loadBsky(uri: string): void {
    this.loadSub.add(
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
      }),
    );
  }

  /**
   * RSS article: resolve the item from its feed, then (if the publisher declares
   * a comment feed) load the comments as descendants. Ids are `rss:<feedUrl>::<guid>`.
   */
  private loadRss(id: string): void {
    this.isRss.set(true);
    const body = id.slice('rss:'.length);
    const sep = body.indexOf('::');
    if (sep === -1) {
      this.loading.set(false);
      return;
    }
    const feedUrl = body.slice(0, sep);
    const guid = body.slice(sep + 2);
    this.ancestors.set([]);
    this.descendants.set([]);
    this.loadSub.add(
      this.rss.getFeedItem(feedUrl, guid).subscribe({
        next: (view) => {
          this.status.set(view.status);
          this.loading.set(false);
          if (view.commentsFeedUrl) {
            this.rssHasCommentFeed.set(true);
            this.loadRssComments(view.commentsFeedUrl, feedUrl, view.status.id);
          }
        },
        error: () => this.loading.set(false),
      }),
    );
  }

  private loadRssComments(commentsFeedUrl: string, feedUrl: string, parentId: string): void {
    this.loadSub.add(
      this.rss.getComments(commentsFeedUrl, feedUrl, parentId).subscribe({
        next: (comments) => {
          this.descendants.set(comments);
          this.rssCommentsUnavailable.set(comments.length === 0);
        },
        // A declared comment feed that won't load (CORS, 404) is common; note it.
        error: () => this.rssCommentsUnavailable.set(true),
      }),
    );
  }

  toggleReader(): void {
    this.readerMode.update((v) => !v);
  }

  bumpReaderFont(delta: number): void {
    this.prefs.setReaderFontSize(this.prefs.readerFontSize() + delta);
  }

  onReply(status: Status): void {
    // Local practice replies also draw an Eliza answer into the store, so
    // re-assemble the whole thread rather than only appending the viewer's line.
    const focused = this.status();
    if (focused && this.isLocal(focused)) {
      this.loadLocal(focused.id);
      return;
    }
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

  protected isBluesky(post: Status): boolean {
    return post.provider === 'bluesky';
  }

  /** True for a browser-local practice post (Eliza's or the viewer's) — its reply
   *  box is the local composer, never the network one. */
  protected isLocal(post: Status): boolean {
    return isElizaId(post.id) || post.id.startsWith('local:');
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
