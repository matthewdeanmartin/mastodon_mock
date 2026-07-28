import { effect, Injectable, signal, WritableSignal } from '@angular/core';
import { scopedKey } from './account-scope';
import { isCanaryBuild } from './build-flavor';
import { ProviderId } from './models';

const PREFS_KEY = 'mockingbird_client_prefs';

/**
 * Which feed sources are hidden is per-account, not global: one account may have
 * a Bluesky chip toggled off that another account doesn't even have. Kept in its
 * own account-scoped key (see {@link scopedKey}) rather than the shared prefs
 * blob so a filter set on one login never follows the user to another.
 */
const HIDDEN_PROVIDERS_KEY_BASE = 'mockingbird_hidden_providers';

/**
 * The account's own posting default (`source.privacy`), mirrored locally so the
 * composer can open on it without a request. Necessarily per-account, and for
 * the same reason as {@link HIDDEN_PROVIDERS_KEY_BASE} it gets its own scoped
 * key rather than a slot in the shared prefs blob.
 */
const DEFAULT_VISIBILITY_KEY_BASE = 'mockingbird_default_visibility';

const PROVIDER_IDS: ProviderId[] = ['mastodon', 'anonymous-mastodon', 'bluesky', 'rss', 'paste'];

export type ThemeMode = 'light' | 'dark' | 'auto';

/** Mastodon's four post visibilities, in descending reach. */
export const VISIBILITY_VALUES = ['public', 'unlisted', 'private', 'direct'] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

/** Narrow an untrusted value (stored JSON, an API `source.privacy`) to a visibility. */
export function asVisibility(value: unknown): Visibility | null {
  return typeof value === 'string' && (VISIBILITY_VALUES as readonly string[]).includes(value)
    ? (value as Visibility)
    : null;
}

/** When the blue verification check shows on other accounts. */
export type VerifiedMode = 'fixed' | 'famous' | 'everyone';
export type ReaderFontFamily = 'serif' | 'sans' | 'mono';
export type ReaderTextAlign = 'left' | 'justify';

// Chat-list filters (the toggles above the conversation list).
export type ChatAudience = 'everyone' | 'mutuals';
export type ChatKindFilter = 'all' | 'private' | 'public' | 'bsky';

/** Algo-feed audience chip: everything, or only posts authored by follows. */
export type AlgoAudience = 'all' | 'friends';

/** Whether the favourite action renders as a star or a heart. */
export type FavStyle = 'star' | 'heart';

/** What a post is called across the UI: fediverse "post" or bird-site "tweet". */
export type PostNoun = 'post' | 'tweet';

/** Custom color overrides; a `#rrggbb` string, or null for the theme default. */
export type CustomColor = string | null;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface AccentPreset {
  id: string;
  label: string;
  accent: string;
  accentHover: string;
  /** Tint used for soft backgrounds (light theme; dark theme derives its own). */
  accentSoft: string;
}

/** Accent color presets, Twitter-Blue style. The first entry is the classic default. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blue', label: 'Blue', accent: '#1da1f2', accentHover: '#1a91da', accentSoft: '#e8f5fe' },
  {
    id: 'yellow',
    label: 'Yellow',
    accent: '#ffad1f',
    accentHover: '#e79c16',
    accentSoft: '#fff5e0',
  },
  { id: 'rose', label: 'Rose', accent: '#f91880', accentHover: '#dd1573', accentSoft: '#fee7f2' },
  {
    id: 'purple',
    label: 'Purple',
    accent: '#7856ff',
    accentHover: '#6a4ce0',
    accentSoft: '#efebff',
  },
  {
    id: 'orange',
    label: 'Orange',
    accent: '#ff7a00',
    accentHover: '#e56e00',
    accentSoft: '#ffefe0',
  },
  { id: 'green', label: 'Green', accent: '#00ba7c', accentHover: '#00a56e', accentSoft: '#e0f7ef' },
];

const FONT_STACKS: Record<ReaderFontFamily, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'Cascadia Code', Consolas, 'Courier New', monospace",
};

interface StoredPrefs {
  themeMode?: ThemeMode;
  accentId?: string;
  /** Legacy combined pref; migrated to confirmBeforePost + delayedSend on load. */
  undoSend?: boolean;
  confirmBeforePost?: boolean;
  delayedSend?: boolean;
  verifiedMode?: VerifiedMode;
  readerFontSize?: number;
  readerFontFamily?: ReaderFontFamily;
  readerFontWeight?: number;
  readerLineHeight?: number;
  readerLetterSpacing?: number;
  readerWordSpacing?: number;
  readerTextAlign?: ReaderTextAlign;
  feedReader?: boolean;
  showImages?: boolean;
  hiddenProviders?: ProviderId[];
  chatAudience?: ChatAudience;
  chatKind?: ChatKindFilter;
  feedMin?: number;
  feedMax?: number;
  algoAudience?: AlgoAudience;
  algoCalm?: boolean;
  algoTags?: boolean;
  favStyle?: FavStyle;
  postNoun?: PostNoun;
  zenMode?: boolean;
  analytics?: boolean;
  requireAltText?: boolean;
  thoughtfulPosting?: boolean;
  customBg?: CustomColor;
  customLink?: CustomColor;
  customSidebar?: CustomColor;
  excludeUnknownLangTrends?: boolean;
  knownLanguages?: string[];
  hideForeignLangPosts?: boolean;
}

/** ISO 639-1 codes normalized/deduped; also drives the trending-tag language filter. */
function normalizeLangs(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') {
      continue;
    }
    const code = raw.toLowerCase().split(/[-_]/)[0];
    if (/^[a-z]{2,3}$/.test(code)) {
      seen.add(code);
    }
  }
  return [...seen];
}

/** Feed-size bounds (see feedMin / feedMax). */
export const FEED_MIN_DEFAULT = 20;
export const FEED_MAX_DEFAULT = 500;
const FEED_MIN_FLOOR = 5;
const FEED_MAX_CEILING = 5000;
/** How long the "you've had enough" cap sticks before it lifts, in ms. */
export const FEED_MAX_COOLDOWN_MS = 60 * 60 * 1000;

/** Clamp helper shared by the numeric reader prefs. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Client-only preferences persisted in localStorage. These must work against any
 * Mastodon instance (e.g. mastodon.social), so nothing here touches the server.
 *
 * The service applies theme + accent to `document.documentElement` as
 * `data-theme` / `data-accent` attributes (`styles.css` carries the palettes),
 * reader typography as `--reader-*` CSS variables, and the feed-wide reader /
 * images toggles as `data-feed-reader` / `data-images` attributes so every
 * timeline picks them up without wiring.
 */
@Injectable({ providedIn: 'root' })
export class ClientPrefs {
  readonly themeMode = signal<ThemeMode>('auto');
  /**
   * Accent defaults to blue, but canary builds (/canary/ base href) default to
   * yellow so the two deployments look distinct. This is only the default: a
   * stored user choice loaded in load() takes precedence.
   */
  readonly accentId = signal<string>(isCanaryBuild() ? 'yellow' : 'blue');
  /** Ask "do you really want to post that?" before sending. */
  readonly confirmBeforePost = signal<boolean>(false);
  /** Hold posts for 30 seconds with a cancel (and publish-now) option. */
  readonly delayedSend = signal<boolean>(false);
  /** Who gets a blue check: fixed follower bar, more followers than me, or everyone. */
  readonly verifiedMode = signal<VerifiedMode>('fixed');

  // Reader typography (thread reader mode + feed reader mode).
  readonly readerFontSize = signal<number>(18);
  readonly readerFontFamily = signal<ReaderFontFamily>('serif');
  readonly readerFontWeight = signal<number>(400);
  readonly readerLineHeight = signal<number>(1.65);
  readonly readerLetterSpacing = signal<number>(0);
  readonly readerWordSpacing = signal<number>(0);
  readonly readerTextAlign = signal<ReaderTextAlign>('left');

  // Feed-wide toggles (command bar).
  readonly feedReader = signal<boolean>(false);
  readonly showImages = signal<boolean>(true);

  /** Providers filtered OUT of the home feed via the command-bar chips. */
  readonly hiddenProviders = signal<ProviderId[]>([]);

  /**
   * The account's posting default (`source.privacy`), cached from the last
   * `verify_credentials`. This is a *mirror*, not a preference: the server owns
   * the value and Settings → Posting is where it is changed. It exists so the
   * composer can open on the user's real default without spending a request on
   * the hot path — see {@link setDefaultVisibility}. Anonymous sessions have no
   * server-side default and keep the `public` fallback.
   */
  readonly defaultVisibility = signal<Visibility>('public');

  // Chat-list filters.
  readonly chatAudience = signal<ChatAudience>('everyone');
  readonly chatKind = signal<ChatKindFilter>('all');

  // Algo-feed filters.
  readonly algoAudience = signal<AlgoAudience>('all');
  /** Calm mode: hide posts the rage lexicon flags as inflammatory. */
  readonly algoCalm = signal<boolean>(false);
  /** Include popular recent posts from followed hashtags in the Algo feed. */
  readonly algoTags = signal<boolean>(true);

  /**
   * Feed-size bounds. `feedMin` auto-loads more pages until the feed holds at
   * least this many (or the timeline is exhausted). `feedMax` caps how much a
   * feed will load in one sitting; hitting it disables "Load more" until a
   * cooldown passes or the page reloads.
   */
  readonly feedMin = signal<number>(FEED_MIN_DEFAULT);
  readonly feedMax = signal<number>(FEED_MAX_DEFAULT);

  /** Favourite buttons render as ⭐ (Mastodon-style) or ❤️ (Twitter-style). */
  readonly favStyle = signal<FavStyle>('star');
  /** "post"/"boost" (Mastodon-style) or "tweet"/"retweet" (bird-site nostalgia). */
  readonly postNoun = signal<PostNoun>('post');
  /** Zen mode: both sidebars disappear, leaving just the feed column. */
  readonly zenMode = signal<boolean>(false);
  /**
   * Whether anonymous page-view analytics run at all.
   *
   * Opt-out rather than opt-in, but a real one: when this is off the analytics
   * script is never injected, so nothing is loaded, counted or sent — see
   * {@link AnalyticsTracker}. Stored app-wide, not per account, because it is a
   * statement about this browser rather than about an identity.
   */
  readonly analytics = signal<boolean>(true);
  /** Opt-in: refuse to post while any attached image lacks alt text. */
  readonly requireAltText = signal<boolean>(false);

  /**
   * Thoughtful posting: nothing publishes straight from a text box.
   *
   * With this on, Home has no composer — just a Write button that opens an
   * editor at the top of /drafts, and that editor only saves. Posting happens
   * later, deliberately, from a draft row. The gap between writing something and
   * coming back to it is the entire feature.
   *
   * Replies, chats, and the paste-share composer are never gated: replies are
   * urgent, and a paste link was already a deliberate act. See the composer's
   * `gateable` input for which surfaces opt in.
   */
  readonly thoughtfulPosting = signal<boolean>(false);

  // Custom colors (null = keep the theme's own value).
  readonly customBg = signal<CustomColor>(null);
  readonly customLink = signal<CustomColor>(null);
  readonly customSidebar = signal<CustomColor>(null);

  /**
   * Hide trending tags detected as a language the user doesn't know. **On by
   * default**: with ~3000 human languages, a reader who happens to know the one
   * a tag is written in is the rare case, so the sensible default is to exclude
   * tags we're *sure* are foreign. The filter only ever hides tags whose script
   * commits to a known-foreign language; anything undetermined (all Latin tags,
   * bare Han for a reader who might know zh/ja) is still kept — so "we can't tell
   * your language" degrades to showing everything, never hiding by mistake. See
   * {@link KnownLanguages} for how "known" is derived and the
   * TrendLanguageFilter service for where it is applied.
   */
  readonly excludeUnknownLangTrends = signal<boolean>(true);
  /**
   * Languages the user has explicitly said they know (ISO 639-1). This is the
   * future home of Mastodon's "public timeline languages" checkbox list; it
   * augments — never replaces — the languages we can infer from the UI language,
   * the browser, and the posting default.
   */
  readonly knownLanguages = signal<string[]>([]);

  /**
   * Hide feed posts (Home, Algo) that are confidently in a language the user
   * doesn't know, or that misrepresent their own language. Off by default. Like
   * the trending filter, it never hides a post whose language can't be
   * determined — see the FeedLanguageFilter service.
   */
  readonly hideForeignLangPosts = signal<boolean>(false);

  /** Resolved theme actually in effect ('auto' resolved against the OS preference). */
  readonly resolvedTheme = signal<'light' | 'dark'>('light');

  private readonly darkQuery: MediaQueryList | null =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  constructor() {
    this.load();
    this.darkQuery?.addEventListener('change', () => this.apply());
    effect(() => {
      this.apply();
      this.persist();
    });
  }

  setThemeMode(mode: ThemeMode): void {
    this.themeMode.set(mode);
  }

  setAccent(id: string): void {
    if (ACCENT_PRESETS.some((p) => p.id === id)) {
      this.accentId.set(id);
    }
  }

  setConfirmBeforePost(enabled: boolean): void {
    this.confirmBeforePost.set(enabled);
  }

  setDelayedSend(enabled: boolean): void {
    this.delayedSend.set(enabled);
  }

  setVerifiedMode(mode: VerifiedMode): void {
    if (mode === 'fixed' || mode === 'famous' || mode === 'everyone') {
      this.verifiedMode.set(mode);
    }
  }

  setReaderFontSize(px: number): void {
    this.readerFontSize.set(clamp(px, 15, 24));
  }

  setReaderFontFamily(family: ReaderFontFamily): void {
    if (family in FONT_STACKS) {
      this.readerFontFamily.set(family);
    }
  }

  setReaderFontWeight(weight: number): void {
    this.readerFontWeight.set(clamp(Math.round(weight / 100) * 100, 300, 700));
  }

  setReaderLineHeight(value: number): void {
    this.readerLineHeight.set(clamp(value, 1.2, 2.4));
  }

  setReaderLetterSpacing(px: number): void {
    this.readerLetterSpacing.set(clamp(px, 0, 3));
  }

  setReaderWordSpacing(px: number): void {
    this.readerWordSpacing.set(clamp(px, 0, 8));
  }

  setReaderTextAlign(align: ReaderTextAlign): void {
    if (align === 'left' || align === 'justify') {
      this.readerTextAlign.set(align);
    }
  }

  setFeedReader(on: boolean): void {
    this.feedReader.set(on);
  }

  setShowImages(on: boolean): void {
    this.showImages.set(on);
  }

  isProviderVisible(id: ProviderId): boolean {
    return !this.hiddenProviders().includes(id);
  }

  setChatAudience(who: ChatAudience): void {
    if (who === 'everyone' || who === 'mutuals') {
      this.chatAudience.set(who);
    }
  }

  setChatKind(kind: ChatKindFilter): void {
    if (kind === 'all' || kind === 'private' || kind === 'public' || kind === 'bsky') {
      this.chatKind.set(kind);
    }
  }

  setAlgoAudience(audience: AlgoAudience): void {
    if (audience === 'all' || audience === 'friends') {
      this.algoAudience.set(audience);
    }
  }

  setAlgoCalm(on: boolean): void {
    this.algoCalm.set(on);
  }

  setAlgoTags(on: boolean): void {
    this.algoTags.set(on);
  }

  setFeedMin(n: number): void {
    if (Number.isFinite(n)) {
      this.feedMin.set(clamp(Math.round(n), FEED_MIN_FLOOR, this.feedMax()));
    }
  }

  setFeedMax(n: number): void {
    if (Number.isFinite(n)) {
      const max = clamp(Math.round(n), FEED_MIN_FLOOR, FEED_MAX_CEILING);
      this.feedMax.set(max);
      // Keep min ≤ max.
      if (this.feedMin() > max) {
        this.feedMin.set(max);
      }
    }
  }

  setFavStyle(style: FavStyle): void {
    if (style === 'star' || style === 'heart') {
      this.favStyle.set(style);
    }
  }

  setPostNoun(noun: PostNoun): void {
    if (noun === 'post' || noun === 'tweet') {
      this.postNoun.set(noun);
    }
  }

  setZenMode(on: boolean): void {
    this.zenMode.set(on);
  }

  /** Turn page-view analytics on or off. Takes effect on the next page view. */
  setAnalytics(on: boolean): void {
    this.analytics.set(on);
  }

  setRequireAltText(on: boolean): void {
    this.requireAltText.set(on);
  }

  setThoughtfulPosting(on: boolean): void {
    this.thoughtfulPosting.set(on);
  }

  setCustomBg(color: CustomColor): void {
    this.customBg.set(normalizeColor(color));
  }

  setCustomLink(color: CustomColor): void {
    this.customLink.set(normalizeColor(color));
  }

  setCustomSidebar(color: CustomColor): void {
    this.customSidebar.set(normalizeColor(color));
  }

  setExcludeUnknownLangTrends(on: boolean): void {
    this.excludeUnknownLangTrends.set(on);
  }

  /** Replace the explicit known-languages list (deduped, normalized). */
  setKnownLanguages(list: string[]): void {
    this.knownLanguages.set(normalizeLangs(list));
  }

  setHideForeignLangPosts(on: boolean): void {
    this.hideForeignLangPosts.set(on);
  }

  /** Add one language to the explicit known-languages list. */
  addKnownLanguage(code: string): void {
    this.knownLanguages.update((list) => normalizeLangs([...list, code]));
  }

  /** Remove one language from the explicit known-languages list. */
  removeKnownLanguage(code: string): void {
    const bare = code.toLowerCase().split(/[-_]/)[0];
    this.knownLanguages.update((list) => list.filter((c) => c !== bare));
  }

  /**
   * Mirror the account's posting default. Called wherever a credential account
   * lands (login, boot, account switch, saving Settings → Posting). An
   * unrecognized or absent value leaves the previous cache alone rather than
   * resetting it: a partial response should not silently widen the user's
   * default back to `public`.
   */
  setDefaultVisibility(privacy: unknown): void {
    const visibility = asVisibility(privacy);
    if (visibility) {
      this.defaultVisibility.set(visibility);
    }
  }

  toggleProvider(id: ProviderId): void {
    this.hiddenProviders.update((hidden) =>
      hidden.includes(id) ? hidden.filter((p) => p !== id) : [...hidden, id],
    );
  }

  private load(): void {
    let stored: StoredPrefs = {};
    try {
      stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as StoredPrefs;
    } catch {
      // Corrupt prefs: fall back to defaults.
    }
    if (
      stored.themeMode === 'light' ||
      stored.themeMode === 'dark' ||
      stored.themeMode === 'auto'
    ) {
      this.themeMode.set(stored.themeMode);
    }
    if (
      typeof stored.accentId === 'string' &&
      ACCENT_PRESETS.some((p) => p.id === stored.accentId)
    ) {
      this.accentId.set(stored.accentId);
    }
    // Legacy combined pref maps onto both halves; explicit new keys win.
    this.loadBool(stored.undoSend, this.confirmBeforePost);
    this.loadBool(stored.undoSend, this.delayedSend);
    this.loadBool(stored.confirmBeforePost, this.confirmBeforePost);
    this.loadBool(stored.delayedSend, this.delayedSend);
    if (
      stored.verifiedMode === 'fixed' ||
      stored.verifiedMode === 'famous' ||
      stored.verifiedMode === 'everyone'
    ) {
      this.verifiedMode.set(stored.verifiedMode);
    }
    this.loadBool(stored.feedReader, this.feedReader);
    this.loadBool(stored.showImages, this.showImages);
    if (typeof stored.readerFontSize === 'number') {
      this.setReaderFontSize(stored.readerFontSize);
    }
    if (typeof stored.readerFontFamily === 'string' && stored.readerFontFamily in FONT_STACKS) {
      this.readerFontFamily.set(stored.readerFontFamily);
    }
    if (typeof stored.readerFontWeight === 'number') {
      this.setReaderFontWeight(stored.readerFontWeight);
    }
    if (typeof stored.readerLineHeight === 'number') {
      this.setReaderLineHeight(stored.readerLineHeight);
    }
    if (typeof stored.readerLetterSpacing === 'number') {
      this.setReaderLetterSpacing(stored.readerLetterSpacing);
    }
    if (typeof stored.readerWordSpacing === 'number') {
      this.setReaderWordSpacing(stored.readerWordSpacing);
    }
    if (stored.readerTextAlign === 'left' || stored.readerTextAlign === 'justify') {
      this.readerTextAlign.set(stored.readerTextAlign);
    }
    this.loadHiddenProviders(stored);
    this.loadDefaultVisibility();
    if (stored.chatAudience === 'everyone' || stored.chatAudience === 'mutuals') {
      this.chatAudience.set(stored.chatAudience);
    }
    if (
      stored.chatKind === 'all' ||
      stored.chatKind === 'private' ||
      stored.chatKind === 'public' ||
      stored.chatKind === 'bsky'
    ) {
      this.chatKind.set(stored.chatKind);
    }
    // A legacy stored 'platform' value simply falls back to the 'all' default.
    if (stored.algoAudience === 'all' || stored.algoAudience === 'friends') {
      this.algoAudience.set(stored.algoAudience);
    }
    this.loadBool(stored.algoCalm, this.algoCalm);
    this.loadBool(stored.algoTags, this.algoTags);
    // feedMax first so setFeedMin can clamp against it.
    if (typeof stored.feedMax === 'number') {
      this.setFeedMax(stored.feedMax);
    }
    if (typeof stored.feedMin === 'number') {
      this.setFeedMin(stored.feedMin);
    }
    if (stored.favStyle === 'star' || stored.favStyle === 'heart') {
      this.favStyle.set(stored.favStyle);
    }
    if (stored.postNoun === 'post' || stored.postNoun === 'tweet') {
      this.postNoun.set(stored.postNoun);
    }
    this.loadBool(stored.zenMode, this.zenMode);
    this.loadBool(stored.analytics, this.analytics);
    this.loadBool(stored.requireAltText, this.requireAltText);
    this.loadBool(stored.thoughtfulPosting, this.thoughtfulPosting);
    this.customBg.set(normalizeColor(stored.customBg ?? null));
    this.customLink.set(normalizeColor(stored.customLink ?? null));
    this.customSidebar.set(normalizeColor(stored.customSidebar ?? null));
    this.loadBool(stored.excludeUnknownLangTrends, this.excludeUnknownLangTrends);
    this.knownLanguages.set(normalizeLangs(stored.knownLanguages));
    this.loadBool(stored.hideForeignLangPosts, this.hideForeignLangPosts);
  }

  private loadBool(value: boolean | undefined, target: WritableSignal<boolean>): void {
    if (typeof value === 'boolean') {
      target.set(value);
    }
  }

  private persist(): void {
    const prefs: StoredPrefs = {
      themeMode: this.themeMode(),
      accentId: this.accentId(),
      confirmBeforePost: this.confirmBeforePost(),
      delayedSend: this.delayedSend(),
      verifiedMode: this.verifiedMode(),
      readerFontSize: this.readerFontSize(),
      readerFontFamily: this.readerFontFamily(),
      readerFontWeight: this.readerFontWeight(),
      readerLineHeight: this.readerLineHeight(),
      readerLetterSpacing: this.readerLetterSpacing(),
      readerWordSpacing: this.readerWordSpacing(),
      readerTextAlign: this.readerTextAlign(),
      feedReader: this.feedReader(),
      showImages: this.showImages(),
      chatAudience: this.chatAudience(),
      chatKind: this.chatKind(),
      feedMin: this.feedMin(),
      feedMax: this.feedMax(),
      algoAudience: this.algoAudience(),
      algoCalm: this.algoCalm(),
      algoTags: this.algoTags(),
      favStyle: this.favStyle(),
      postNoun: this.postNoun(),
      zenMode: this.zenMode(),
      analytics: this.analytics(),
      requireAltText: this.requireAltText(),
      thoughtfulPosting: this.thoughtfulPosting(),
      customBg: this.customBg(),
      customLink: this.customLink(),
      customSidebar: this.customSidebar(),
      excludeUnknownLangTrends: this.excludeUnknownLangTrends(),
      knownLanguages: this.knownLanguages(),
      hideForeignLangPosts: this.hideForeignLangPosts(),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    // Hidden providers live in their own account-scoped key, not the global blob.
    localStorage.setItem(
      scopedKey(HIDDEN_PROVIDERS_KEY_BASE),
      JSON.stringify(this.hiddenProviders()),
    );
    localStorage.setItem(scopedKey(DEFAULT_VISIBILITY_KEY_BASE), this.defaultVisibility());
  }

  /**
   * Load this account's cached posting default. Stored as a bare string (not
   * JSON) so a hand-inspected localStorage entry reads as `private` rather than
   * `"private"`; anything unrecognized falls back to `public`.
   */
  private loadDefaultVisibility(): void {
    let stored: string | null;
    try {
      stored = localStorage.getItem(scopedKey(DEFAULT_VISIBILITY_KEY_BASE));
    } catch {
      return;
    }
    const visibility = asVisibility(stored);
    if (visibility) {
      this.defaultVisibility.set(visibility);
    }
  }

  /**
   * Load the per-account hidden-provider filter. Prefers the account-scoped key;
   * falls back once to a legacy `hiddenProviders` still sitting in the global
   * prefs blob (migrating pre-scope installs so their current filter isn't lost),
   * then leaves the blob's copy to be dropped on the next persist.
   */
  private loadHiddenProviders(stored: StoredPrefs): void {
    const valid = (list: unknown): ProviderId[] =>
      Array.isArray(list) ? (list as ProviderId[]).filter((p) => PROVIDER_IDS.includes(p)) : [];
    const scoped = localStorage.getItem(scopedKey(HIDDEN_PROVIDERS_KEY_BASE));
    if (scoped !== null) {
      try {
        this.hiddenProviders.set(valid(JSON.parse(scoped)));
        return;
      } catch {
        // Corrupt scoped value: fall through to the legacy blob / default.
      }
    }
    if (Array.isArray(stored.hiddenProviders)) {
      this.hiddenProviders.set(valid(stored.hiddenProviders));
      // Consume the legacy blob copy for this account only, then strip it so no
      // other account inherits it on their first (unscoped) load.
      delete stored.hiddenProviders;
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
      } catch {
        // If storage write fails, the next persist() still drops it.
      }
    }
  }

  private apply(): void {
    const mode = this.themeMode();
    const dark = mode === 'dark' || (mode === 'auto' && (this.darkQuery?.matches ?? false));
    this.resolvedTheme.set(dark ? 'dark' : 'light');
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-accent', this.accentId());
    root.setAttribute('data-feed-reader', this.feedReader() ? 'on' : 'off');
    root.setAttribute('data-images', this.showImages() ? 'on' : 'off');
    root.style.setProperty('--reader-font-family', FONT_STACKS[this.readerFontFamily()]);
    root.style.setProperty('--reader-font-size', `${this.readerFontSize()}px`);
    root.style.setProperty('--reader-font-weight', `${this.readerFontWeight()}`);
    root.style.setProperty('--reader-line-height', `${this.readerLineHeight()}`);
    root.style.setProperty('--reader-letter-spacing', `${this.readerLetterSpacing()}px`);
    root.style.setProperty('--reader-word-spacing', `${this.readerWordSpacing()}px`);
    root.style.setProperty('--reader-text-align', this.readerTextAlign());
    // Custom colors ride on top of the theme/accent as inline overrides;
    // clearing one falls back to whatever the palette defines.
    setOrRemove(root, '--bg', this.customBg());
    setOrRemove(root, '--accent', this.customLink());
    setOrRemove(root, '--accent-hover', this.customLink());
    setOrRemove(root, '--rail-bg', this.customSidebar());
  }
}

function setOrRemove(root: HTMLElement, prop: string, value: CustomColor): void {
  if (value) {
    root.style.setProperty(prop, value);
  } else {
    root.style.removeProperty(prop);
  }
}

function normalizeColor(color: CustomColor): CustomColor {
  return color && HEX_COLOR.test(color) ? color.toLowerCase() : null;
}
