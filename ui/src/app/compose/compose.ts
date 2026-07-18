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
import { CustomEmojis } from '../custom-emojis';
import { Draft, DraftSnapshot, Drafts, draftHasContent } from '../drafts';
import { EmojiPicker } from '../emoji-picker/emoji-picker';
import { ComposeOptions, MediaAttachment, Status } from '../models';
import { BlueskyApi } from '../providers/bluesky/bluesky-api';
import { detectFacets, graphemeLength } from '../providers/bluesky/bluesky-facets';
import { buildLocalBskyStatus } from '../providers/bluesky/bluesky-local-status';
import { BlueskySession } from '../providers/bluesky/bluesky-session';
import { BskyFacet } from '../providers/bluesky/bluesky-types';
import { applyMinimalMarkdown } from '../markdown';
import { Terminology } from '../terminology';
import { renderStatusText } from './status-text';

const VISIBILITIES = ['public', 'unlisted', 'private', 'direct'] as const;

/** Mastodon's default per-status character limit. */
export const MAX_POST_CHARS = 500;

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

/** Mastodon accepts images, video and audio as attachments. */
function isAttachable(file: File): boolean {
  return /^(image|video|audio)\//.test(file.type);
}

/** True when the drag carries files (not text selections, links, …). */
function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

@Component({
  selector: 'app-compose',
  imports: [FormsModule, EmojiPicker],
  templateUrl: './compose.html',
  styleUrl: './compose.css',
})
export class Compose implements OnDestroy {
  private api = inject(Api);
  private prefs = inject(ClientPrefs);
  private bskyApi = inject(BlueskyApi);
  private bskySession = inject(BlueskySession);
  private drafts = inject(Drafts);
  private customEmojis = inject(CustomEmojis);
  protected words = inject(Terminology).words;

  ngOnDestroy(): void {
    this.clearCountdown();
    this.flushAutosave();
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
  /** A saved draft to open in the composer (it is consumed from the drafts list). */
  readonly initialDraft = input<Draft | undefined>(undefined);
  /**
   * Chat-style compact layout: everything on one toolbar row, preview off by
   * default (toggleable), drafts behind an icon. Used where vertical and
   * horizontal space is scarce (/conversations).
   */
  readonly compact = input(false);
  readonly posted = output<Status>();

  protected readonly visibilities = VISIBILITIES;
  protected readonly pollExpiry = POLL_EXPIRY;

  protected text = signal('');
  /** Extra thread boxes ("tweet storm"): each is one additional self-reply post. */
  protected thread = signal<string[]>([]);
  protected submitting = signal(false);

  // Visibility + content warning.
  protected visibility = signal<string>('public');

  /** Every box in order; index 0 is the primary post. */
  protected segments = computed(() => [this.text(), ...this.thread()]);

  constructor() {
    // Seed the composer from inputs once they resolve (runs again only if the
    // container swaps the bound conversation), then let any autosaved text or
    // an explicitly opened draft override the seed.
    effect(() => {
      this.text.set(this.initialText());
      this.visibility.set(this.initialVisibility());
      const draft = this.initialDraft();
      const saved = draft ?? this.drafts.loadAutosave(this.contextKey());
      if (saved && draftHasContent(saved)) {
        this.applySnapshot(saved);
      }
      if (draft) {
        // The draft moves into the composer (and its autosave slot).
        this.drafts.remove(draft.id);
      }
      this.restored = true;
    });

    effect(() => this.previewOn.set(!this.compact()));

    // Autosave (debounced) so a stray reload never eats a half-written post.
    effect(() => {
      const snapshot = this.snapshot();
      const key = this.contextKey();
      if (!this.restored) {
        return;
      }
      // The preview only needs the custom-emoji list once a :shortcode: shows up.
      if (snapshot.segments.some((s) => /:[a-z0-9_]+:/i.test(s))) {
        this.customEmojis.ensureLoaded();
      }
      if (this.autosaveTimer) {
        clearTimeout(this.autosaveTimer);
      }
      this.autosaveTimer = setTimeout(() => {
        this.autosaveTimer = null;
        this.drafts.autosave(key, snapshot);
      }, 500);
    });
  }

  private restored = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  protected cwOpen = signal(false);
  protected spoilerText = signal('');
  protected sensitive = signal(false);

  // Media.
  protected media = signal<PendingMedia[]>([]);
  protected uploading = signal(false);

  // Scheduling. The value is a datetime-local string (browser-local time);
  // it's converted to ISO only when sending.
  protected scheduleOpen = signal(false);
  protected scheduleAt = signal('');
  /** A schedule only takes effect when the picker is open and holds a value. */
  protected scheduleActive = computed(() => this.scheduleOpen() && !!this.scheduleAt());
  /** Mastodon publishes immediately when scheduled_at is < ~5 min out. */
  protected scheduleTooSoon = computed(() => {
    if (!this.scheduleActive()) {
      return false;
    }
    const at = new Date(this.scheduleAt()).getTime();
    return !Number.isNaN(at) && at - Date.now() < 6 * 60_000;
  });
  /** "Scheduled for …" flash after a successful scheduled submit. */
  protected scheduledFlash = signal<string | null>(null);
  private scheduledFlashTimer: ReturnType<typeof setTimeout> | null = null;

  private flashScheduled(message: string): void {
    this.scheduledFlash.set(message);
    if (this.scheduledFlashTimer) {
      clearTimeout(this.scheduledFlashTimer);
    }
    this.scheduledFlashTimer = setTimeout(() => this.scheduledFlash.set(null), 8000);
  }

  toggleSchedule(): void {
    this.scheduleOpen.update((v) => !v);
    if (!this.scheduleOpen()) {
      this.scheduleAt.set('');
    }
  }

  /** min= for the picker: 10 minutes out, in datetime-local format. */
  protected scheduleMin(): string {
    const d = new Date(Date.now() + 10 * 60_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  // Poll.
  protected pollOpen = signal(false);
  protected pollOptions = signal<string[]>(['', '']);
  protected pollMultiple = signal(false);
  protected pollExpiresIn = signal<number>(86400);

  /** Media and polls are mutually exclusive, matching Mastodon. */
  protected canAttachMedia = computed(() => !this.pollOpen());
  protected canAddPoll = computed(() => this.media().length === 0);

  // Live preview (rendered like the feed will render it — not WYSIWYG).
  // Appears as soon as there's a character to render, gone when empty.
  // Compact composers start with it off; the 👁 toolbar button toggles it.
  protected previewOn = signal(true);
  protected previewVisible = computed(
    () => this.previewOn() && this.segments().some((s) => s.trim() !== ''),
  );
  /** Compact mode hides the drafts picker behind a 📝 toolbar toggle. */
  protected draftsOpen = signal(false);
  protected previewHtml = computed(() =>
    this.segments().map((s) =>
      applyMinimalMarkdown(renderStatusText(s, this.customEmojis.emojis())),
    ),
  );

  // Emoji panel.
  protected emojiOpen = signal(false);
  /** The box (index + element) that last had focus, for emoji insertion. */
  private lastFocusedBox: { index: number; el: HTMLTextAreaElement } | null = null;

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

  protected readonly maxChars = MAX_POST_CHARS;

  /** Any box over the limit blocks posting (no more silent auto-splitting). */
  protected overLimit = computed(() => this.segments().some((s) => s.length > MAX_POST_CHARS));

  /** "Saved to drafts" flash after an explicit save. */
  protected draftSaved = signal(false);
  private draftSavedTimer: ReturnType<typeof setTimeout> | null = null;

  /** Opt-in accessibility gate: some attached image still lacks alt text. */
  protected altTextMissing = computed(
    () => this.prefs.requireAltText() && this.media().some((m) => !m.description.trim()),
  );

  protected canSubmit = computed(() => {
    if (this.submitting() || this.uploading() || this.countdown() !== null) {
      return false;
    }
    if (this.overLimit() || this.altTextMissing()) {
      return false;
    }
    if (this.scheduleActive()) {
      // Scheduling covers exactly one post: no threads, no Bluesky leg.
      if (this.thread().some((t) => t.trim()) || this.targetIncludesBsky()) {
        return false;
      }
    }
    if (this.targetIncludesBsky()) {
      // Bluesky legs are text-only, single-post, capped at 300 graphemes.
      if (!this.text().trim() || this.bskyRemaining() < 0) {
        return false;
      }
      if (this.thread().some((t) => t.trim())) {
        return false;
      }
      if (this.target() === 'bsky' && (this.media().length > 0 || this.pollOpen())) {
        return false;
      }
      return true;
    }
    const hasText = this.segments().some((s) => s.trim());
    const hasMedia = this.media().length > 0;
    const hasPoll = this.pollOpen() && this.pollOptions().filter((o) => o.trim()).length >= 2;
    return hasText || hasMedia || hasPoll;
  });

  // --- thread boxes ---

  addThreadBox(): void {
    this.thread.update((list) => [...list, '']);
  }

  setThreadText(index: number, value: string): void {
    this.thread.update((list) => list.map((t, i) => (i === index ? value : t)));
  }

  removeThreadBox(index: number): void {
    this.thread.update((list) => list.filter((_, i) => i !== index));
  }

  /** Remember which box has focus so emoji insertion lands in the right place. */
  onBoxFocus(index: number, event: FocusEvent): void {
    this.lastFocusedBox = { index, el: event.target as HTMLTextAreaElement };
  }

  /** Mastodon-compatible keys inside the box: ctrl/⌘+enter sends, alt+x toggles CW. */
  onBoxKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.submit();
    } else if (event.altKey && event.code === 'KeyX') {
      event.preventDefault();
      this.toggleCw();
    } else if (event.key === 'Escape') {
      (event.target as HTMLTextAreaElement).blur();
    }
  }

  // --- emoji ---

  toggleEmoji(): void {
    this.emojiOpen.update((v) => !v);
    if (this.emojiOpen()) {
      this.customEmojis.ensureLoaded();
    }
  }

  /** Insert picked emoji text at the caret of the last-focused box. */
  insertEmoji(emojiText: string): void {
    const box = this.lastFocusedBox ?? { index: 0, el: null };
    const current = box.index === 0 ? this.text() : (this.thread()[box.index - 1] ?? '');
    const start = box.el?.selectionStart ?? current.length;
    const end = box.el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + emojiText + current.slice(end);
    if (box.index === 0) {
      this.text.set(next);
    } else {
      this.setThreadText(box.index - 1, next);
    }
    // Put the caret right after the inserted emoji.
    const el = box.el;
    if (el) {
      setTimeout(() => {
        el.focus();
        const caret = start + emojiText.length;
        el.setSelectionRange(caret, caret);
      });
    }
  }

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
    this.uploadFiles(files);
  }

  /** Pasting an image (screenshot, copied file) attaches it; plain text pastes normally. */
  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    const media = files.filter((f) => isAttachable(f));
    if (!media.length) {
      return;
    }
    event.preventDefault();
    this.uploadFiles(media);
  }

  // Drag & drop anywhere on the composer attaches the dropped files.
  // Depth-counted because dragenter/leave also fire on every child element.
  protected dragOver = signal(false);
  private dragDepth = 0;

  onDragEnter(event: DragEvent): void {
    if (!dragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.dragDepth++;
    this.dragOver.set(this.canAttachMedia());
  }

  onDragOver(event: DragEvent): void {
    if (dragHasFiles(event)) {
      // Without this the browser navigates to the dropped file.
      event.preventDefault();
    }
  }

  onDragLeave(_event: DragEvent): void {
    if (this.dragDepth > 0 && --this.dragDepth === 0) {
      this.dragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    if (!dragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.dragDepth = 0;
    this.dragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => isAttachable(f));
    this.uploadFiles(files);
  }

  /** In-flight uploads; `uploading` stays true until the last one settles. */
  private pendingUploads = 0;

  private uploadFiles(files: File[]): void {
    if (!this.canAttachMedia() || !files.length) {
      return;
    }
    for (const file of files) {
      this.pendingUploads++;
      this.uploading.set(true);
      this.api.uploadMedia(file).subscribe({
        next: (media) => {
          this.media.update((list) => [...list, { media, description: '' }]);
          this.settleUpload();
        },
        error: () => this.settleUpload(),
      });
    }
  }

  private settleUpload(): void {
    if (--this.pendingUploads <= 0) {
      this.pendingUploads = 0;
      this.uploading.set(false);
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

  // --- drafts ---

  /** 'new', 'reply:<id>' or 'quote:<id>' — each context autosaves separately. */
  private contextKey(): string {
    const reply = this.inReplyToId();
    if (reply) {
      return `reply:${reply}`;
    }
    const quote = this.quotedStatusId();
    if (quote) {
      return `quote:${quote}`;
    }
    return 'new';
  }

  private snapshot(): DraftSnapshot {
    return {
      segments: this.segments(),
      spoilerText: this.cwOpen() ? this.spoilerText() : '',
      sensitive: this.sensitive(),
      visibility: this.visibility(),
      poll: this.pollOpen()
        ? {
            options: this.pollOptions(),
            multiple: this.pollMultiple(),
            expiresIn: this.pollExpiresIn(),
          }
        : null,
      inReplyToId: this.inReplyToId(),
      quotedStatusId: this.quotedStatusId(),
    };
  }

  private applySnapshot(d: DraftSnapshot): void {
    this.text.set(d.segments[0] ?? '');
    this.thread.set(d.segments.slice(1));
    this.spoilerText.set(d.spoilerText);
    this.cwOpen.set(!!d.spoilerText);
    this.sensitive.set(d.sensitive);
    if (!this.lockVisibility()) {
      this.visibility.set(d.visibility);
    }
    if (d.poll) {
      this.pollOpen.set(true);
      this.pollOptions.set(d.poll.options.length >= 2 ? d.poll.options : ['', '']);
      this.pollMultiple.set(d.poll.multiple);
      this.pollExpiresIn.set(d.poll.expiresIn);
    } else {
      this.pollOpen.set(false);
      this.pollOptions.set(['', '']);
      this.pollMultiple.set(false);
    }
  }

  /** True when there's anything a draft could keep. */
  protected hasDraftContent = computed(
    () =>
      this.segments().some((s) => s.trim()) || (this.cwOpen() && this.spoilerText().trim() !== ''),
  );

  /** The saved-drafts list, for the picker dropdown. */
  protected savedDrafts = this.drafts.drafts;

  /** Short label for a draft in the picker. */
  draftLabel(d: Draft): string {
    const text = d.segments.find((s) => s.trim()) ?? '';
    const snippet = text.trim().replace(/\s+/g, ' ');
    if (snippet) {
      return snippet.length > 32 ? snippet.slice(0, 32) + '…' : snippet;
    }
    return d.poll ? '(poll draft)' : '(empty draft)';
  }

  /**
   * The drafts dropdown: save the current text as a draft, or load one.
   * Loading swaps — anything half-written is saved as a draft first, so
   * picking a draft never loses work.
   */
  onDraftSelect(select: HTMLSelectElement): void {
    const value = select.value;
    select.value = '';
    if (value === 'save') {
      this.saveDraft();
      return;
    }
    const draft = this.drafts.get(value);
    if (!draft) {
      return;
    }
    if (draftHasContent(this.snapshot())) {
      this.drafts.save(this.snapshot());
    }
    this.drafts.remove(draft.id);
    this.applySnapshot(draft);
  }

  /** Move the current composer state into the drafts list and clear the box. */
  saveDraft(): void {
    const snapshot = this.snapshot();
    if (!draftHasContent(snapshot)) {
      return;
    }
    this.drafts.save(snapshot);
    this.reset();
    this.draftSaved.set(true);
    if (this.draftSavedTimer) {
      clearTimeout(this.draftSavedTimer);
    }
    this.draftSavedTimer = setTimeout(() => this.draftSaved.set(false), 4000);
  }

  private flushAutosave(): void {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
      this.drafts.autosave(this.contextKey(), this.snapshot());
    }
    if (this.draftSavedTimer) {
      clearTimeout(this.draftSavedTimer);
    }
    if (this.scheduledFlashTimer) {
      clearTimeout(this.scheduledFlashTimer);
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

    if (this.scheduleActive()) {
      // A far-enough scheduled_at returns a ScheduledStatus (has `params`);
      // a near/past one publishes immediately and returns a plain Status —
      // tell them apart so the feed and the flash message stay honest.
      // canSubmit already ruled out threads/Bluesky.
      const when = new Date(this.scheduleAt());
      options.scheduledAt = when.toISOString();
      this.api.postStatus(this.text().trim(), options).subscribe({
        next: (result) => {
          this.reset();
          if ('params' in result) {
            this.flashScheduled(`Scheduled for ${when.toLocaleString()} — see it under Drafts.`);
          } else {
            this.flashScheduled('That was under ~5 minutes away, so it was posted right away.');
            this.posted.emit(result);
          }
        },
        error: () => this.submitting.set(false),
      });
      return;
    }

    // Thread boxes post as a self-reply chain: media/poll/CW ride on the first
    // status only, the rest inherit visibility and chain as replies.
    const posts = this.segments()
      .map((s) => s.trim())
      .filter((s, i) => i === 0 || s !== '');
    this.api.postStatus(posts[0], options).subscribe({
      next: (status) => this.postRest(status, status, posts.slice(1)),
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
              'Posted to Fedi, but the Bluesky copy failed — post it there manually.',
            );
          }
        },
      });
  }

  /** Post remaining thread posts sequentially, then emit the root status. */
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
    this.thread.set([]);
    this.submitting.set(false);
    this.cwOpen.set(false);
    this.spoilerText.set('');
    this.sensitive.set(false);
    this.media.set([]);
    this.pollOpen.set(false);
    this.pollOptions.set(['', '']);
    this.pollMultiple.set(false);
    this.scheduleOpen.set(false);
    this.scheduleAt.set('');
    this.emojiOpen.set(false);
    this.lastFocusedBox = null;
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.drafts.clearAutosave(this.contextKey());
  }
}
