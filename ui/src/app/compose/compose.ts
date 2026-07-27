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
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { Api } from '../api';
import { PageDiagnostics } from '../page-diagnostics';
import { Auth } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';
import { CustomEmojis } from '../custom-emojis';
import { Draft, DraftSnapshot, Drafts, draftHasContent } from '../drafts';
import { EmojiPicker } from '../emoji-picker/emoji-picker';
import { ComposeOptions, MediaAttachment, Status } from '../models';
import { BlueskyApi } from '../providers/bluesky/bluesky-api';
import { detectFacets, graphemeLength } from '../providers/bluesky/bluesky-facets';
import { buildLocalBskyStatus } from '../providers/bluesky/bluesky-local-status';
import { BlueskySession } from '../providers/bluesky/bluesky-session';
import { BskyFacet } from '../providers/bluesky/bluesky-types';
import { PasteHistory } from '../providers/paste/paste-history';
import { PasteExpiry } from '../providers/paste/paste-provider';
import { PasteProviderRegistry } from '../providers/paste/paste-provider-registry';
import { applyMinimalMarkdown } from '../markdown';
import { Terminology } from '../terminology';
import { renderStatusText } from './status-text';
import { FeatureFlags } from '../feature-flags';
import { KnownLanguages } from '../trend-language-filter';
import { LANG_NAMES, LangCode, detectLanguage } from '../language-detect';
import { stripHtml } from '../sentiment';

const VISIBILITIES = ['public', 'unlisted', 'private', 'direct'] as const;

/** Mastodon's default per-status character limit. */
export const MAX_POST_CHARS = 500;

/** Where a top-level compose publishes. Paste is always exclusive to avoid correlation. */
export type PostTarget = 'fedi' | 'bsky' | 'both' | 'paste';

/** Bluesky's post limit, in graphemes (not characters). */
const BSKY_MAX_GRAPHEMES = 300;
const MAX_PASTE_BYTES = 2 * 1024 * 1024;

/**
 * Pull the HTTP status out of a paste failure for logging. A cross-origin fetch
 * that a CORS policy blocks (or that never connects) surfaces as an
 * HttpErrorResponse with `status: 0` — the browser deliberately hides the real
 * response, so there is no code to show and no point retrying.
 */
function describePasteFailure(error: unknown): { status: number | null; hint: string } {
  if (error instanceof HttpErrorResponse) {
    return {
      status: error.status,
      hint:
        error.status === 0
          ? 'CORS-blocked or network failure — status is opaque to the browser'
          : error.statusText || 'HTTP error',
    };
  }
  return { status: null, hint: error instanceof Error ? error.message : 'non-HTTP error' };
}

/** One extra field from an error body, rendered as a labelled row. */
export interface PostFailureDetail {
  label: string;
  value: string;
}

/**
 * A failed post, in a shape the UI can render without knowing the server.
 *
 * `message` is the headline. `details` carries everything else the body said.
 */
export interface PostFailure {
  message: string;
  details: PostFailureDetail[];
}

/** Fields we render as the headline or handle specially, not as detail rows. */
const HANDLED_ERROR_KEYS = new Set(['error', 'error_description', 'message', 'detail', 'details']);

/** Keys not worth showing a user: plumbing, not explanation. */
const NOISE_ERROR_KEYS = new Set(['request_id', 'status', 'statuscode', 'timestamp', 'path']);

/** Turn snake_case / camelCase keys into something readable. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Render a JSON value as a single readable line. */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(stringifyValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanizeKey(k)}: ${stringifyValue(v)}`)
      .filter(Boolean)
      .join('; ');
  }
  return '';
}

/** Parse an error body that may arrive already-parsed or as a raw string. */
function parseErrorBody(raw: unknown): Record<string, unknown> | null {
  let body = raw;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // A non-JSON body (an HTML error page) is not worth showing verbatim.
      return null;
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/**
 * Turn a failed post into something worth showing the user.
 *
 * Servers reject posts for reasons the user can act on — too long, a link in
 * the text, a missing hashtag, moderated wording — and they say which in the
 * response body. Rendering "try again" instead tells the user nothing and they
 * retry the identical text forever.
 *
 * Deliberately generic about the body's shape. Server-side validation evolves,
 * and a client that only understands the codes it was written against gets
 * steadily less useful as new ones appear. So: use the known message fields for
 * the headline, then show *every other field* as a labelled row rather than
 * discarding it. A rule this client has never heard of still explains itself.
 */
export function describePostFailure(error: unknown): PostFailure {
  const plain = (message: string): PostFailure => ({ message, details: [] });

  if (!(error instanceof HttpErrorResponse)) {
    return plain(
      error instanceof Error && error.message ? error.message : "Couldn't post — try again.",
    );
  }
  // status 0 is the browser hiding a CORS/network failure; there is no body.
  if (error.status === 0) {
    return plain("Couldn't reach the server (offline, or it isn't sending CORS headers).");
  }

  const body = parseErrorBody(error.error);
  if (!body) {
    if (error.status === 401 || error.status === 403) {
      return plain('That account is no longer signed in — reauthenticate and try again.');
    }
    return plain(`Couldn't post (HTTP ${error.status}) — try again.`);
  }

  // Headline: the first human-readable field the server offered.
  let message = '';
  for (const key of ['error_description', 'error', 'message', 'detail']) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) {
      message = v.trim();
      break;
    }
  }

  // Everything else the body carried. This is what keeps the client useful as
  // the server grows rules it has never heard of: an unrecognized `limit`,
  // `field`, or `retry_at` still reaches the user instead of being dropped.
  const details: PostFailureDetail[] = [];
  for (const [key, value] of Object.entries(body)) {
    const lower = key.toLowerCase();
    if (HANDLED_ERROR_KEYS.has(lower) || NOISE_ERROR_KEYS.has(lower)) continue;
    const text = stringifyValue(value);
    if (text) {
      details.push({ label: humanizeKey(key), value: text });
    }
  }

  if (!message) {
    if (error.status === 401 || error.status === 403) {
      message = 'That account is no longer signed in — reauthenticate and try again.';
    } else if (details.length) {
      // The body said something, just not in a field we recognize as the
      // headline. The detail rows below carry it.
      message = 'The server rejected that post:';
    } else {
      message = `Couldn't post (HTTP ${error.status}) — try again.`;
    }
  }

  return { message, details };
}

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
  imports: [FormsModule, EmojiPicker, ConfirmDialog],
  templateUrl: './compose.html',
  styleUrl: './compose.css',
})
export class Compose implements OnDestroy {
  private api = inject(Api);
  protected auth = inject(Auth);
  private prefs = inject(ClientPrefs);
  private bskyApi = inject(BlueskyApi);
  protected bskySession = inject(BlueskySession);
  private drafts = inject(Drafts);
  private customEmojis = inject(CustomEmojis);
  protected pasteProviders = inject(PasteProviderRegistry);
  private pasteHistory = inject(PasteHistory);
  private diagnostics = inject(PageDiagnostics);
  protected featureFlags = inject(FeatureFlags);
  protected words = inject(Terminology).words;
  private knownLanguages = inject(KnownLanguages);

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
  /**
   * The parent author's handle (bare `acct`, e.g. `alice@dmv.community`) for a
   * reply. When set and no explicit {@link initialText} is given, the composer
   * seeds `@handle ` into the box so the reply actually notifies them — matching
   * mastodon.social's own default. Verified live: a reply with `in_reply_to_id`
   * but no `@handle` in the body threads correctly yet sends NO notification, so
   * this seed is what makes "reply" ping the person by default. The user can
   * delete the handle to reply silently; {@link showReplyMentionHint} explains it.
   */
  readonly replyToHandle = input('');
  /**
   * Optional initial visibility (e.g. 'direct' for a conversation reply). Empty
   * means "no opinion" — the composer then opens on the account's own posting
   * default (`ClientPrefs.defaultVisibility`), which is what a top-level compose
   * wants. A caller that passes a value is always obeyed.
   */
  readonly initialVisibility = input('');
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
  /**
   * Whether this mount participates in "thoughtful posting" (see
   * {@link ClientPrefs.thoughtfulPosting}). Opt-in, and deliberately so: a
   * surface that should have been gated but isn't merely behaves as it always
   * has, while a surface that shouldn't have been gated but is would silently
   * stop someone replying. Only Home and the quote composers opt in — replies,
   * chats, and the paste-share composer never do.
   */
  readonly gateable = input(false);
  readonly posted = output<Status>();

  /**
   * True when this composer must not publish: it saves a draft instead, and the
   * post happens later from /drafts. The whole point is the gap in between.
   */
  protected gated = computed(() => this.gateable() && this.prefs.thoughtfulPosting());

  protected readonly visibilities = VISIBILITIES;
  protected readonly pollExpiry = POLL_EXPIRY;

  protected text = signal('');
  /** Extra thread boxes ("tweet storm"): each is one additional self-reply post. */
  protected thread = signal<string[]>([]);
  protected submitting = signal(false);

  // Visibility + content warning.
  protected visibility = signal<string>('public');

  /**
   * The visibility in effect before a paste-driven clamp overwrote it.
   *
   * Paste services only understand `public`/`unlisted` (and burn-after-reading
   * only `unlisted`), so selecting Paste has to narrow whatever the user had.
   * Without this, switching Fedi → Paste → Fedi silently left the post on
   * `unlisted` — a real downgrade of a deliberate choice, and the reason this
   * exists. Null means "nothing to put back": either no clamp has happened, or
   * the user has since picked a visibility by hand while on Paste, which
   * outranks anything we remembered for them.
   */
  private stashedVisibility: string | null = null;

  /**
   * Selected post language: an ISO 639-1 code, or '' for "Not specified" (let
   * the server auto-detect). The picker offers only the languages we believe
   * the user knows ({@link KnownLanguages}) rather than all ~180 ISO codes —
   * you almost always post in a language you read. Defaults to the posting
   * default when it's among the known set, else "Not specified".
   */
  protected postLanguage = signal<string>('');
  /** Options for the language picker: the known languages, named + sorted. */
  protected languageOptions = computed(() =>
    [...this.knownLanguages.codes()]
      .map((code) => ({ code, name: LANG_NAMES[code as LangCode] ?? code.toUpperCase() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  /** True once the default has been seeded, so it isn't re-applied over a user pick. */
  private seededLanguage = false;

  /**
   * A pending "you picked X but this reads as Y" confirmation. Non-null blocks
   * the send and drives the warning banner; the user either fixes the picker or
   * confirms and posts anyway.
   */
  protected langMismatch = signal<{ picked: string; detected: string } | null>(null);

  /**
   * A mismatch the user explicitly dismissed ("keep editing"). While the picked
   * language and detected language still match this pair, {@link submit} won't
   * re-raise the banner — so dismissing genuinely gets it out of the way instead
   * of having it pop straight back on the next Post. Cleared whenever the picker
   * changes or the text is re-detected to something new.
   */
  private dismissedMismatch = signal<{ picked: string; detected: string } | null>(null);

  /** Every box in order; index 0 is the primary post. */
  protected segments = computed(() => [this.text(), ...this.thread()]);

  /**
   * Whether to show the "removing the @handle replies without notifying them"
   * hint. Shown only for replies whose body currently *leads* with an @mention —
   * so it appears while the seeded handle is present and quietly disappears the
   * moment the user deletes it (their signal that they've opted out of the ping).
   */
  protected showReplyMentionHint = computed(
    () => !!this.inReplyToId() && /^\s*@[\w.-]+(@[\w.-]+)?/.test(this.text()),
  );

  constructor() {
    // Seed the composer from inputs + any autosaved text or explicitly opened
    // draft. This re-seeds only when the *conversation context* changes (a
    // container like /conversations reuses one instance across replies), keyed
    // by contextKey + draft identity. It must NOT re-run on unrelated signal
    // churn: it reads localStorage, so re-applying within the same context would
    // reload the previous autosave and silently clobber a live edit — e.g. the
    // paste provider the user just picked, before the debounced autosave below
    // has written it. The `seededKey` guard prevents that.
    effect(() => {
      const draft = this.initialDraft();
      // A caller's explicit initialText wins; otherwise, for a reply, seed the
      // parent author's @handle so the reply notifies them by default (see
      // replyToHandle). Never seed the user's own handle — like mastodon.social,
      // replying to yourself gets an empty box. Non-reply composers seed nothing.
      const handle = this.replyToHandle().trim();
      const mine = this.auth.account()?.acct;
      const seedHandle = handle && handle !== mine ? `@${handle} ` : '';
      const initialText = this.initialText() || seedHandle;
      const initialVisibility = this.initialVisibility();
      const key = `${this.contextKey()}|${draft?.id ?? ''}`;
      if (key === this.seededKey) {
        return;
      }
      this.seededKey = key;
      this.text.set(initialText);
      // No caller opinion means a top-level compose: open on the account's own
      // posting default rather than assuming `public`.
      this.visibility.set(initialVisibility || this.prefs.defaultVisibility());
      this.stashedVisibility = null;
      // A handoff from "Edit for post" outranks a stale autosave: the user just
      // asked for this specific post, and it only ever seeds once. An explicitly
      // opened draft still wins over both.
      const handoff = this.acceptsHandoff() ? this.drafts.takeHandoff() : null;
      this.selfDraftOrigin = handoff?.selfStatusId ?? null;
      const saved = draft ?? handoff?.snapshot ?? this.drafts.loadAutosave(this.contextKey());
      if (saved && draftHasContent(saved)) {
        this.diagnostics.info('Paste', 'draft:restore', {
          context: this.contextKey(),
          source: draft ? 'draft' : handoff ? 'handoff' : 'autosave',
          target: saved.target ?? 'fedi',
          provider: saved.pasteProviderId ?? this.pasteProviders.default.id,
        });
        this.applySnapshot(saved);
      }
      if (draft) {
        // The draft moves into the composer (and its autosave slot).
        this.drafts.remove(draft.id);
      }
      this.restored = true;
    });

    effect(() => this.previewOn.set(!this.compact()));

    this.seedDefaultLanguage();

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

  /**
   * The self-draft this composer's text came from, if any.
   *
   * A post-to-self draft is a real status. Publishing it for real leaves the
   * private copy behind as a duplicate — the mastodon.social folk recipe deals
   * with that by deleting and re-drafting, which is destructive *before* the
   * post exists. We do the opposite: publish first, then offer to delete. That
   * way a failed publish can never destroy the only copy of the text.
   */
  private selfDraftOrigin: string | null = null;

  /** The self-draft copy the user is being asked about, after a successful post. */
  protected pendingSelfCleanup = signal<string | null>(null);
  protected selfCleanupError = signal<string | null>(null);

  /**
   * A real post went out. If its text came from a post-to-self draft, the
   * private copy is now a duplicate — ask whether to remove it.
   *
   * Called only where a `Status` actually exists. Not on a *scheduled* result
   * (nothing is published yet, so the copy is still the live version), and not
   * on a paste or a Bluesky post — pasting a private note somewhere public is
   * no reason to delete the private note.
   */
  private offerSelfCleanup(): void {
    if (this.selfDraftOrigin) {
      this.pendingSelfCleanup.set(this.selfDraftOrigin);
      this.selfDraftOrigin = null;
    }
  }

  /** Delete the private copy the just-published post came from. */
  deleteSelfDraftCopy(): void {
    const id = this.pendingSelfCleanup();
    this.pendingSelfCleanup.set(null);
    if (!id) {
      return;
    }
    this.api.deleteStatus(id).subscribe({
      error: () =>
        this.selfCleanupError.set(
          "The private draft copy couldn't be deleted — it's still in your messages.",
        ),
    });
  }

  private restored = false;
  /** The context+draft key the seed effect last applied; guards re-seeding. */
  private seededKey: string | null = null;
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
  protected canAttachMedia = computed(() => !this.targetIncludesPaste() && !this.pollOpen());
  protected canAddPoll = computed(() => !this.targetIncludesPaste() && this.media().length === 0);

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
  protected target = signal<PostTarget>(
    this.auth.isAnonymous && this.featureFlags.enabled('pastebin') ? 'paste' : 'fedi',
  );
  protected showTargetPicker = computed(() => !this.inReplyToId() && !this.quotedStatusId());
  protected targetIncludesBsky = computed(
    () => this.showTargetPicker() && (this.target() === 'bsky' || this.target() === 'both'),
  );
  protected targetIncludesPaste = computed(
    () =>
      this.showTargetPicker() && this.target() === 'paste' && this.featureFlags.enabled('pastebin'),
  );
  protected pasteDisabledTarget = computed(
    () => this.target() === 'paste' && !this.featureFlags.enabled('pastebin'),
  );
  protected pasteProviderId = signal(this.pasteProviders.default.id);
  protected selectedPasteProvider = computed(
    () => this.pasteProviders.get(this.pasteProviderId()) ?? this.pasteProviders.default,
  );
  protected pasteLanguage = signal('plaintext');
  protected pasteExpiry = signal<PasteExpiry>('1w');
  protected pasteBytes = computed(() => new TextEncoder().encode(this.text()).byteLength);
  /** Graphemes left under Bluesky's 300 limit (only meaningful when posting there). */
  protected bskyRemaining = computed(() => BSKY_MAX_GRAPHEMES - graphemeLength(this.text()));
  /** The Bluesky leg of a cross-post failed after the Fedi post went out. */
  protected crossPostError = signal<string | null>(null);
  /**
   * Why the server refused the post. Kept separate from crossPostError: this one
   * means nothing was published, so the text stays in the box for editing.
   */
  protected postError = signal<PostFailure | null>(null);

  protected dismissPostError(): void {
    this.postError.set(null);
  }

  /** Seconds left on the undo-send countdown, or null when no send is pending. */
  protected countdown = signal<number | null>(null);
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly maxChars = MAX_POST_CHARS;

  /** Any box over the limit blocks posting (no more silent auto-splitting). */
  protected overLimit = computed(() =>
    this.targetIncludesPaste()
      ? this.pasteBytes() > MAX_PASTE_BYTES
      : this.segments().some((s) => s.length > MAX_POST_CHARS),
  );

  /** "Saved to drafts" flash after an explicit save. */
  protected draftSaved = signal(false);
  private draftSavedTimer: ReturnType<typeof setTimeout> | null = null;

  /** Opt-in accessibility gate: some attached image still lacks alt text. */
  protected altTextMissing = computed(
    () => this.prefs.requireAltText() && this.media().some((m) => !m.description.trim()),
  );

  protected canSubmit = computed(() => {
    if (this.pasteDisabledTarget()) {
      return false;
    }
    if (this.submitting() || this.uploading() || this.countdown() !== null) {
      return false;
    }
    if (this.overLimit() || this.altTextMissing()) {
      return false;
    }
    if (this.targetIncludesPaste()) {
      return (
        !!this.text().trim() &&
        !this.thread().some((text) => text.trim()) &&
        !this.media().length &&
        !this.pollOpen() &&
        !this.scheduleActive()
      );
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

  /**
   * Narrow the visibility to what the paste target can express, remembering what
   * was there so {@link restoreVisibility} can put it back. Only the *first*
   * clamp stashes: going rentry → tinyurl → fedi must restore what the user
   * chose before any of it, not the value the previous paste provider forced.
   *
   * Only applies while Paste is the live target. Provider/expiry state is also
   * touched when a saved draft is restored ({@link applySnapshot}), and a fedi
   * draft saved as `private` must not be narrowed to `unlisted` just because
   * the composer set up its paste controls on the way past.
   */
  private clampVisibilityForPaste(allowed: readonly string[]): void {
    const current = this.visibility();
    if (this.target() !== 'paste' || allowed.includes(current)) {
      return;
    }
    this.stashedVisibility ??= current;
    this.visibility.set(allowed[0] ?? 'unlisted');
  }

  /**
   * Put back the visibility a paste clamp took away. With nothing stashed (the
   * composer never went near Paste, or the user has since chosen by hand) this
   * falls back to the account's posting default, so a fresh paste-first
   * composer — the anonymous default, see {@link target} — still lands somewhere
   * the user chose rather than on `unlisted`.
   */
  private restoreVisibility(): void {
    this.visibility.set(this.stashedVisibility ?? this.prefs.defaultVisibility());
    this.stashedVisibility = null;
  }

  /** A hand-picked visibility is the user's real intent; forget what we stashed. */
  onVisibilityChange(visibility: string): void {
    this.visibility.set(visibility);
    this.stashedVisibility = null;
  }

  onTargetChange(target: PostTarget): void {
    if (target === 'paste' && !this.featureFlags.enabled('pastebin')) {
      return;
    }
    const wasPaste = this.target() === 'paste';
    this.target.set(target);
    if (target === 'paste') {
      this.clampVisibilityForPaste(this.pasteVisibilities());
    } else if (wasPaste) {
      this.restoreVisibility();
    }
  }

  /**
   * What the selected provider allows, tightened to `unlisted` only for
   * burn-after-reading — a burn link that is also listed publicly defeats the
   * point of burning it.
   */
  private pasteVisibilities(): readonly string[] {
    return this.pasteExpiry() === 'burn' ? ['unlisted'] : this.selectedPasteProvider().visibilities;
  }

  onPasteProviderChange(providerId: string): void {
    const previousProviderId = this.pasteProviderId();
    const provider = this.pasteProviders.get(providerId) ?? this.pasteProviders.default;
    this.pasteProviderId.set(provider.id);
    if (!provider.languages.some((language) => language.value === this.pasteLanguage())) {
      this.pasteLanguage.set(provider.languages[0]?.value ?? 'plaintext');
    }
    if (!provider.expiries.some((expiry) => expiry.value === this.pasteExpiry())) {
      this.pasteExpiry.set(provider.expiries[0]?.value ?? '1w');
    }
    this.clampVisibilityForPaste(this.pasteVisibilities());
    this.diagnostics.info('Paste', 'provider:change', {
      requestedProvider: providerId,
      previousProvider: previousProviderId,
      selectedProvider: this.pasteProviderId(),
      language: this.pasteLanguage(),
      expiry: this.pasteExpiry(),
      visibility: this.visibility(),
    });
  }

  onPasteExpiryChange(expiry: PasteExpiry): void {
    const wasBurn = this.pasteExpiry() === 'burn';
    this.pasteExpiry.set(expiry);
    if (expiry === 'burn') {
      this.clampVisibilityForPaste(['unlisted']);
    } else if (wasBurn) {
      // Leaving burn widens the options again; give back what burn narrowed,
      // then re-clamp in case the provider itself doesn't allow it.
      this.restoreVisibility();
      this.clampVisibilityForPaste(this.pasteVisibilities());
    }
  }

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

  // --- post language ---

  /**
   * Seed the picker from the account's posting-default language, but only if
   * that language is one we'd offer (i.e. in the known set). Reads the already
   * loaded credential account (`source.language`) — no extra request — so it
   * costs nothing and stays "Not specified" when there's no default. Runs once.
   */
  private seedDefaultLanguage(): void {
    if (this.seededLanguage) {
      return;
    }
    this.seededLanguage = true;
    const def = this.auth.account()?.source?.language?.toLowerCase().split(/[-_]/)[0] ?? '';
    if (def && this.knownLanguages.knows(def)) {
      this.postLanguage.set(def);
    }
  }

  onLanguageChange(code: string): void {
    this.postLanguage.set(code);
    // Changing the picker clears any standing mismatch warning, and any prior
    // dismissal — the user picked a new language, so re-check against it.
    this.langMismatch.set(null);
    this.dismissedMismatch.set(null);
  }

  languageName(code: string): string {
    return LANG_NAMES[code as LangCode] ?? code.toUpperCase();
  }

  /**
   * A *confident* language for the composed body, or null when it's too short or
   * ambiguous to tell. Mirrors the feed filter's confidence bar so the warning
   * only fires when detection is actually sure — we don't nag on a "hi".
   */
  private detectedLanguage(): string | null {
    const text = this.segments()
      .map((s) => stripHtml(s))
      .join(' ')
      .trim();
    if (text.length < 20) {
      return null;
    }
    const [top] = detectLanguage(text);
    if (!top || top.lang === 'und' || top.share < 0.6) {
      return null;
    }
    return top.lang;
  }

  /** Post anyway despite the language mismatch (keeps the user's picked value). */
  confirmLanguageAndSend(): void {
    this.langMismatch.set(null);
    this.send();
  }

  /** Adopt the detected language into the picker and dismiss the warning. */
  useDetectedLanguage(): void {
    const detected = this.langMismatch()?.detected;
    if (detected) {
      this.postLanguage.set(detected);
    }
    this.langMismatch.set(null);
    this.dismissedMismatch.set(null);
  }

  /**
   * Close the warning without changing anything and go back to editing. Records
   * the pair so it doesn't immediately re-raise on the next Post; the user can
   * keep their picked language and post when ready, or edit the text (which
   * re-detects and, if it now reads as something else, warns afresh).
   */
  dismissLangMismatch(): void {
    this.dismissedMismatch.set(this.langMismatch());
    this.langMismatch.set(null);
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

  /**
   * Whether this composer should pick up a pending "Edit for post" handoff.
   *
   * Only a top-level composer. Dropping a drafted post into a reply or quote box
   * would attach it to a conversation the user never chose — and with several
   * composers alive at once (a thread page mounts one per card), the first one
   * to seed would silently swallow it.
   */
  private acceptsHandoff(): boolean {
    return this.contextKey() === 'new';
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
      target: this.target(),
      pasteProviderId: this.pasteProviderId(),
      pasteLanguage: this.pasteLanguage(),
      pasteExpiry: this.pasteExpiry(),
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
    const restoredTarget = d.target ?? 'fedi';
    this.target.set(
      this.auth.isAnonymous
        ? this.featureFlags.enabled('pastebin')
          ? 'paste'
          : 'fedi'
        : (restoredTarget === 'bsky' || restoredTarget === 'both') && !this.bskySession.linked()
          ? 'fedi'
          : restoredTarget,
    );
    this.onPasteProviderChange(d.pasteProviderId ?? this.pasteProviders.default.id);
    const provider = this.selectedPasteProvider();
    this.pasteLanguage.set(
      provider.languages.some((language) => language.value === d.pasteLanguage)
        ? (d.pasteLanguage ?? 'plaintext')
        : (provider.languages[0]?.value ?? 'plaintext'),
    );
    const expiry = (d.pasteExpiry as PasteExpiry | undefined) ?? '1w';
    this.pasteExpiry.set(
      provider.expiries.some((option) => option.value === expiry)
        ? expiry
        : (provider.expiries[0]?.value ?? '1w'),
    );
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
    // Enforced here, not just in the template. The gate is the feature — a
    // hotkey, an Enter handler, or a future call site must not be able to
    // publish around it. Saving is what this composer does instead.
    if (this.gated()) {
      this.saveDraft();
      return;
    }
    // Language sanity check: if the user picked a specific language and the text
    // confidently reads as a *different* one, pause and let them fix it or post
    // anyway. Only fires when both are known and disagree — never on unsure text
    // or "Not specified". Skipped for paste/Bluesky targets (no fedi language).
    if (this.postLanguage() && !this.targetIncludesPaste() && !this.targetIncludesBsky()) {
      const detected = this.detectedLanguage();
      const dismissed = this.dismissedMismatch();
      const alreadyDismissed =
        dismissed?.picked === this.postLanguage() && dismissed?.detected === detected;
      if (
        detected &&
        detected !== this.postLanguage() &&
        this.langMismatch() === null &&
        !alreadyDismissed
      ) {
        this.langMismatch.set({ picked: this.postLanguage(), detected });
        return;
      }
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
    if (this.target() === 'paste' && !this.featureFlags.enabled('pastebin')) {
      this.crossPostError.set('Pastebin is disabled in Feature flags.');
      return;
    }
    this.submitting.set(true);
    this.crossPostError.set(null);
    this.postError.set(null);

    if (this.targetIncludesPaste()) {
      this.sendToPaste();
      return;
    }

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
    if (this.postLanguage()) {
      options.language = this.postLanguage();
    }
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
            this.offerSelfCleanup();
            this.posted.emit(result);
          }
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.postError.set(describePostFailure(error));
        },
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
      error: (error: unknown) => {
        this.submitting.set(false);
        this.postError.set(describePostFailure(error));
      },
    });
  }

  private sendToPaste(): void {
    const provider = this.selectedPasteProvider();
    const visibility =
      this.pasteExpiry() !== 'burn' && provider.visibilities.includes('public')
        ? this.visibility() === 'public'
          ? 'public'
          : 'unlisted'
        : 'unlisted';
    const input = {
      title: this.cwOpen() ? this.spoilerText().trim() : '',
      content: this.text().trim(),
      language: this.pasteLanguage(),
      expiry: this.pasteExpiry(),
      visibility,
    } as const;
    this.diagnostics.info('Paste', 'create:start', {
      provider: provider.id,
      selectedProvider: this.pasteProviderId(),
      bytes: new TextEncoder().encode(input.content).byteLength,
      visibility: input.visibility,
    });
    provider.create(input).subscribe({
      next: (created) => {
        this.diagnostics.info('Paste', 'create:success', {
          provider: provider.id,
          url: created.url,
        });
        this.pasteHistory.add(provider.id, provider.label, input, created);
        // The paste went out; if localStorage couldn't retain the link, say so
        // now — it's the one moment the user can still copy it.
        const persistError = this.pasteHistory.persistError();
        if (persistError) {
          this.crossPostError.set(
            `${provider.label} paste created (${created.url}). ${persistError}`,
          );
        }
        this.reset();
        this.posted.emit(
          provider.status({
            slug: created.slug,
            title: input.title || null,
            language: input.language,
            preview: input.content,
            createdAt: new Date().toISOString(),
            url: created.url,
            rawUrl: created.rawUrl,
          }),
        );
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const { status, hint } = describePasteFailure(error);
        this.diagnostics.error('Paste', 'create:error', error, {
          provider: provider.id,
          httpStatus: status,
          hint,
        });
        // status 0 is the browser hiding a CORS/network failure — the service is
        // likely down or not sending CORS headers, which "try again" won't fix.
        this.crossPostError.set(
          status === 0
            ? `Couldn't reach ${provider.label} (blocked or unreachable — the service may be down). Try a different paste service.`
            : `Couldn't create the ${provider.label} paste${status ? ` (HTTP ${status})` : ''} — try again.`,
        );
      },
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
      this.offerSelfCleanup();
      this.posted.emit(root);
      return;
    }
    const options: ComposeOptions = {
      inReplyToId: previous.id,
      visibility: this.visibility(),
    };
    this.api.postStatus(rest[0], options).subscribe({
      next: (status) => this.postRest(root, status, rest.slice(1)),
      // Mid-thread: earlier posts are already public, so this is not a plain
      // retry — say so, or the user re-sends the whole thread and duplicates it.
      error: (error: unknown) => {
        this.submitting.set(false);
        const failure = describePostFailure(error);
        this.postError.set({
          ...failure,
          message: `${failure.message} Earlier posts in this thread were already published.`,
        });
      },
    });
  }

  private reset(): void {
    this.text.set('');
    this.thread.set([]);
    this.submitting.set(false);
    this.postError.set(null);
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
    this.langMismatch.set(null);
    this.lastFocusedBox = null;
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.drafts.clearAutosave(this.contextKey());
  }
}
