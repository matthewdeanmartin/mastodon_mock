import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { Status } from '../../models';
import { adaptAuthor, postUrl, renderRichText } from './bluesky-adapter';
import { BlueskyApi } from './bluesky-api';
import { detectFacets, graphemeLength } from './bluesky-facets';
import { BlueskySession } from './bluesky-session';
import { BskyFacet, BskyRef } from './bluesky-types';

const MAX_GRAPHEMES = 300;

/**
 * Inline reply composer for Bluesky posts: 300-grapheme limit (Bluesky counts
 * graphemes, not characters), link/mention facets generated on send. Kept
 * separate from the Mastodon Compose so that component stays provider-free.
 */
@Component({
  selector: 'app-bsky-reply',
  imports: [FormsModule],
  template: `
    <div class="bsky-reply">
      <textarea
        rows="3"
        [placeholder]="'Reply on Bluesky as @' + handle()"
        [ngModel]="text()"
        (ngModelChange)="text.set($event)"
        [disabled]="posting()"
      ></textarea>
      <div class="reply-footer">
        <span class="muted small" [class.over]="remaining() < 0">{{ remaining() }}</span>
        @if (error(); as msg) {
          <span class="reply-error small">{{ msg }}</span>
        }
        <button
          class="btn"
          [disabled]="!text().trim() || remaining() < 0 || posting()"
          (click)="post()"
        >
          {{ posting() ? 'Replying…' : '🦋 Reply' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .bsky-reply textarea {
      width: 100%;
      box-sizing: border-box;
    }
    .reply-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    .over {
      color: #d63b3b;
      font-weight: 600;
    }
    .reply-error {
      color: #d63b3b;
    }
  `,
})
export class BskyReply {
  private api = inject(BlueskyApi);
  private session = inject(BlueskySession);

  /** The (already unwrapped) Bluesky status being replied to. */
  readonly replyTo = input.required<Status>();
  readonly posted = output<Status>();

  protected text = signal('');
  protected posting = signal(false);
  protected error = signal<string | null>(null);

  protected remaining = computed(() => MAX_GRAPHEMES - graphemeLength(this.text()));
  protected handle = computed(() => this.session.session()?.handle ?? '');

  post(): void {
    const text = this.text().trim();
    if (!text || this.remaining() < 0 || this.posting()) {
      return;
    }
    const ref = this.replyTo().providerRef as BskyRef;
    this.posting.set(true);
    this.error.set(null);
    let sentFacets: BskyFacet[] = [];
    detectFacets(text, (handle) => this.api.resolveHandle(handle))
      .pipe(
        switchMap((facets) => {
          sentFacets = facets;
          return this.api.post({
            text,
            facets: facets.length ? facets : undefined,
            reply: { root: ref.replyRoot, parent: { uri: ref.uri, cid: ref.cid } },
          });
        }),
      )
      .subscribe({
        next: (created) => {
          this.posting.set(false);
          this.text.set('');
          this.posted.emit(this.localStatus(created.uri, created.cid, text, sentFacets, ref));
        },
        error: () => {
          this.posting.set(false);
          this.error.set("Couldn't post the reply — try again.");
        },
      });
  }

  /** Bluesky returns only uri/cid for a new record; build the visible Status locally. */
  private localStatus(
    uri: string,
    cid: string,
    text: string,
    facets: BskyFacet[],
    parent: BskyRef,
  ): Status {
    const session = this.session.session()!;
    const account = adaptAuthor({
      did: session.did,
      handle: session.handle,
      displayName: session.displayName,
      avatar: session.avatar,
    });
    return {
      provider: 'bluesky',
      providerRef: {
        uri,
        cid,
        likeUri: null,
        repostUri: null,
        replyRoot: parent.replyRoot,
      } satisfies BskyRef,
      id: `bsky:${uri}`,
      created_at: new Date().toISOString(),
      edited_at: null,
      content: renderRichText(text, facets),
      spoiler_text: '',
      visibility: 'public',
      url: postUrl(session.handle, uri),
      account,
      reblog: null,
      quote: null,
      in_reply_to_id: `bsky:${parent.uri}`,
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
}
