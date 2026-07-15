import {
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { Api } from '../api';
import { ClientPrefs } from '../client-prefs';
import { ComposeOptions, MediaAttachment, Status } from '../models';
import { BlueskyApi } from '../providers/bluesky/bluesky-api';
import { detectFacets, graphemeLength } from '../providers/bluesky/bluesky-facets';
import { buildLocalBskyStatus } from '../providers/bluesky/bluesky-local-status';
import { BlueskySession } from '../providers/bluesky/bluesky-session';
import { BskyFacet } from '../providers/bluesky/bluesky-types';
import { MAX_POST_CHARS, splitPost } from './post-splitter';

const VISIBILITIES = ['public', 'unlisted', 'private', 'direct'] as const;

/** Where a top-level compose publishes. Fedi is home; Bluesky is opt-in per post. */
export type PostTarget = 'fedi' | 'bsky' | 'both';

/** Bluesky's post limit, in graphemes (not characters). */
const BSKY_MAX_GRAPHEMES = 300;

/** Poll expiry presets (label → seconds). */
const POLL_EXPIRY = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 259200 },
  { label: '7 days', seconds: 604800 },
];

/** A media attachment that has been uploaded and is pending attachment to a post. */
interface PendingMedia {
  media: MediaAttachment;
  description: string;
}

@Component({
  selector: 'app-compose',
  imports: [FormsModule],
  templateUrl: './compose.html',
  styleUrl: './compose.css',
})
export class Compose implements OnDestroy {
  private api = inject(Api);
  private prefs = inject(ClientPrefs);
  private bskyApi = inject(BlueskyApi);
  private bskySession = inject(BlueskySession);

  ngOnDestroy(): void {
    this.clearCountdown();
  }

  readonly inReplyToId = input<string | undefined>(undefined);
  /** When set, the composed status quotes this status id. */
  readonly quotedStatusId = input<string | undefined>(undefined);
  readonly placeholder = input('What is happening?');
  /** Optional pre-seeded body (e.g. @mentions for a direct reply). */
  readonly initialText = input('');
  /** Optional initial visibility (e.g. 'direct' for a conversation reply). */
  readonly initialVisibility = input('public');
  /** Pin visibility to initialVisibility (no picker) — e.g. private chats stay direct. */
  readonly lockVisibility = input(false);
  readonly posted = output<Status>();

  protected readonly visibilities = VISIBILITIES;
  protected readonly pollExpiry = POLL_EXPIRY;

  protected text = signal('');
  protected submitting = signal(false);

  // Visibility + content warning.
  protected visibility = signal<string>('public');

  constructor() {
    // Seed the composer from inputs once they resolve. Runs again only if the
    // container swaps the bound conversation (new initial values).
    effect(() => {
      this.text.set(this.initialText());
      this.visibility.set(this.initialVisibility());
    });
  }
  protected cwOpen = signal(false);
  protected spoilerText = signal('');
  protected sensitive = signal(false);

  // Media.
  protected media = signal<PendingMedia[]>([]);
  protected uploading = signal(false);

  // Poll.
  protected pollOpen = signal(false);
  protected pollOptions = signal<string[]>(['', '']);
  protected pollMultiple = signal(false);
  protected pollExpiresIn = signal<number>(86400);

  /** Media and polls are mutually exclusive, matching Mastodon. */
  protected canAttachMedia = computed(() => !this.pollOpen());
  protected canAddPoll = computed(() => this.media().length === 0);

  // Post target (top-level composes only; replies/quotes always stay on Fedi).
  protected target = signal<PostTarget>('fedi');
  protected showTargetPicker = computed(
    () => this.bskySession.linked() && !this.inReplyToId() && !this.quotedStatusId(),
  );
  protected targetIncludesBsky = computed(
    () => this.showTargetPicker() && this.target() !== 'fedi',
  );
  /** Graphemes left under Bluesky's 300 limit (only meaningful when posting there). */
  protected bskyRemaining = computed(() => BSKY_MAX_GRAPHEMES - graphemeLength(this.text()));
  /** The Bluesky leg of a cross-post failed after the Fedi post went out. */
  protected crossPostError = signal<string | null>(null);

  /** Seconds left on the undo-send countdown, or null when no send is pending. */
  protected countdown = signal<number | null>(null);
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  /** How many statuses the current text will become (auto-split threading). */
  protected chunkCount = computed(() => splitPost(this.text()).length);
  protected readonly maxChars = MAX_POST_CHARS;

  protected canSubmit = computed(() => {
    if (this.submitting() || this.uploading() || this.countdown() !== null) {
      return false;
    }
    if (this.targetIncludesBsky()) {
      // Bluesky legs are text-only and capped at 300 graphemes (no auto-thread).
      if (!this.text().trim() || this.bskyRemaining() < 0) {
        return false;
      }
      if (this.target() === 'bsky' && (this.media().length > 0 || this.pollOpen())) {
        return false;
      }
      return true;
    }
    const hasText = !!this.text().trim();
    const hasMedia = this.media().length > 0;
    const hasPoll = this.pollOpen() && this.pollOptions().filter((o) => o.trim()).length >= 2;
    return hasText || hasMedia || hasPoll;
  });

  toggleCw(): void {
    this.cwOpen.update((v) => !v);
    if (!this.cwOpen()) {
      this.spoilerText.set('');
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      this.uploading.set(true);
      this.api.uploadMedia(file).subscribe({
        next: (media) => {
          this.media.update((list) => [...list, { media, description: '' }]);
          this.uploading.set(false);
        },
        error: () => this.uploading.set(false),
      });
    }
  }

  setMediaDescription(index: number, description: string): void {
    this.media.update((list) => list.map((m, i) => (i === index ? { ...m, description } : m)));
  }

  removeMedia(index: number): void {
    this.media.update((list) => list.filter((_, i) => i !== index));
  }

  togglePoll(): void {
    this.pollOpen.update((v) => !v);
    if (!this.pollOpen()) {
      this.pollOptions.set(['', '']);
      this.pollMultiple.set(false);
    }
  }

  setPollOption(index: number, value: string): void {
    this.pollOptions.update((opts) => opts.map((o, i) => (i === index ? value : o)));
  }

  addPollOption(): void {
    if (this.pollOptions().length < 4) {
      this.pollOptions.update((opts) => [...opts, '']);
    }
  }

  removePollOption(index: number): void {
    if (this.pollOptions().length > 2) {
      this.pollOptions.update((opts) => opts.filter((_, i) => i !== index));
    }
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    if (this.prefs.confirmBeforePost() && !confirm('Do you really want to post that?')) {
      return;
    }
    if (this.prefs.delayedSend()) {
      this.countdown.set(30);
      this.countdownTimer = setInterval(() => {
        const left = (this.countdown() ?? 1) - 1;
        if (left <= 0) {
          this.clearCountdown();
          this.send();
        } else {
          this.countdown.set(left);
        }
      }, 1000);
      return;
    }
    this.send();
  }

  /** Abort a pending undo-send countdown, keeping the draft intact. */
  cancelSend(): void {
    this.clearCountdown();
  }

  /** Skip the rest of a pending countdown and post immediately. */
  publishNow(): void {
    if (this.countdown() === null) {
      return;
    }
    this.clearCountdown();
    this.send();
  }

  private clearCountdown(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdown.set(null);
  }

  private send(): void {
    this.submitting.set(true);
    this.crossPostError.set(null);

    if (this.targetIncludesBsky()) {
      const text = this.text().trim();
      if (this.target() === 'bsky') {
        this.sendToBluesky(text, true);
        return;
      }
      // 'both': Fedi is primary (emits the posted status); the Bluesky leg is
      // fired alongside and reports failure without retracting the Fedi post.
      this.sendToBluesky(text, false);
    }

    const options: ComposeOptions = {
      inReplyToId: this.inReplyToId(),
      quotedStatusId: this.quotedStatusId(),
      visibility: this.visibility(),
    };
    if (this.cwOpen() && this.spoilerText().trim()) {
      options.spoilerText = this.spoilerText().trim();
    }
    if (this.sensitive()) {
      options.sensitive = true;
    }
    if (this.media().length) {
      options.mediaIds = this.media().map((m) => m.media.id);
    }
    if (this.pollOpen()) {
      const pollOpts = this.pollOptions()
        .map((o) => o.trim())
        .filter(Boolean);
      if (pollOpts.length >= 2) {
        options.poll = {
          options: pollOpts,
          expiresIn: this.pollExpiresIn(),
          multiple: this.pollMultiple(),
        };
      }
    }

    // Persist any alt-text the user typed before sending the status.
    for (const m of this.media()) {
      if (m.description.trim()) {
        this.api.updateMedia(m.media.id, m.description.trim()).subscribe();
      }
    }

    // Over-limit text is auto-split into a self-reply thread; media/poll/CW ride
    // on the first status only, the rest inherit visibility and chain as replies.
    const chunks = splitPost(this.text().trim());
    this.api.postStatus(chunks[0], options).subscribe({
      next: (status) => this.postRest(status, status, chunks.slice(1)),
      error: () => this.submitting.set(false),
    });
  }

  /**
   * Publish the text (link/mention facets attached) as a top-level Bluesky
   * post. When `primary`, this IS the post: it resets the composer and emits
   * a locally-built Status; otherwise it's the secondary leg of "both" and
   * only surfaces errors.
   */
  private sendToBluesky(text: string, primary: boolean): void {
    let sentFacets: BskyFacet[] = [];
    detectFacets(text, (handle) => this.bskyApi.resolveHandle(handle))
      .pipe(
        switchMap((facets) => {
          sentFacets = facets;
          return this.bskyApi.post({ text, facets: facets.length ? facets : undefined });
        }),
      )
      .subscribe({
        next: (created) => {
          if (primary) {
            this.reset();
            this.posted.emit(
              buildLocalBskyStatus(
                this.bskySession.session()!,
                created.uri,
                created.cid,
                text,
                sentFacets,
              ),
            );
          }
        },
        error: () => {
          if (primary) {
            this.submitting.set(false);
            this.crossPostError.set("Couldn't post to Bluesky — try again.");
          } else {
            this.crossPostError.set(
              "Posted to Fedi, but the Bluesky copy failed — post it there manually.",
            );
          }
        },
      });
  }

  /** Post remaining thread chunks sequentially, then emit the root status. */
  private postRest(root: Status, previous: Status, rest: string[]): void {
    if (!rest.length) {
      this.reset();
      this.posted.emit(root);
      return;
    }
    const options: ComposeOptions = {
      inReplyToId: previous.id,
      visibility: this.visibility(),
    };
    this.api.postStatus(rest[0], options).subscribe({
      next: (status) => this.postRest(root, status, rest.slice(1)),
      error: () => this.submitting.set(false),
    });
  }

  private reset(): void {
    this.text.set('');
    this.submitting.set(false);
    this.cwOpen.set(false);
    this.spoilerText.set('');
    this.sensitive.set(false);
    this.media.set([]);
    this.pollOpen.set(false);
    this.pollOptions.set(['', '']);
    this.pollMultiple.set(false);
  }
}
