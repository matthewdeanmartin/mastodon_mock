import { effect, Injectable, signal, WritableSignal } from '@angular/core';
import { ProviderId } from './models';

const PREFS_KEY = 'mockingbird_client_prefs';

const PROVIDER_IDS: ProviderId[] = ['mastodon', 'bluesky', 'rss'];

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ReaderFontFamily = 'serif' | 'sans' | 'mono';
export type ReaderTextAlign = 'left' | 'justify';

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
  undoSend?: boolean;
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
}

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
  readonly accentId = signal<string>('blue');
  readonly undoSend = signal<boolean>(false);

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

  setUndoSend(enabled: boolean): void {
    this.undoSend.set(enabled);
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
    this.loadBool(stored.undoSend, this.undoSend);
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
    if (Array.isArray(stored.hiddenProviders)) {
      this.hiddenProviders.set(stored.hiddenProviders.filter((p) => PROVIDER_IDS.includes(p)));
    }
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
      undoSend: this.undoSend(),
      readerFontSize: this.readerFontSize(),
      readerFontFamily: this.readerFontFamily(),
      readerFontWeight: this.readerFontWeight(),
      readerLineHeight: this.readerLineHeight(),
      readerLetterSpacing: this.readerLetterSpacing(),
      readerWordSpacing: this.readerWordSpacing(),
      readerTextAlign: this.readerTextAlign(),
      feedReader: this.feedReader(),
      showImages: this.showImages(),
      hiddenProviders: this.hiddenProviders(),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
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
  }
}
