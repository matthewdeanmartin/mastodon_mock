import { effect, Injectable, signal } from '@angular/core';

const PREFS_KEY = 'mockingbird_client_prefs';

export type ThemeMode = 'light' | 'dark' | 'auto';

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

interface StoredPrefs {
  themeMode?: ThemeMode;
  accentId?: string;
  undoSend?: boolean;
  readerFontSize?: number;
}

/**
 * Client-only preferences persisted in localStorage. These must work against any
 * Mastodon instance (e.g. mastodon.social), so nothing here touches the server.
 *
 * The service applies theme + accent to `document.documentElement` as
 * `data-theme` / `data-accent` attributes; `styles.css` carries the palettes.
 */
@Injectable({ providedIn: 'root' })
export class ClientPrefs {
  readonly themeMode = signal<ThemeMode>('auto');
  readonly accentId = signal<string>('blue');
  readonly undoSend = signal<boolean>(false);
  readonly readerFontSize = signal<number>(18);

  /** Resolved theme actually in effect ('auto' resolved against the OS preference). */
  readonly resolvedTheme = signal<'light' | 'dark'>('light');

  private readonly darkQuery: MediaQueryList | null =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  constructor() {
    this.load();
    this.darkQuery?.addEventListener('change', () => this.applyTheme());
    effect(() => {
      this.applyTheme();
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
    this.readerFontSize.set(Math.min(24, Math.max(15, px)));
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
    if (typeof stored.undoSend === 'boolean') {
      this.undoSend.set(stored.undoSend);
    }
    if (typeof stored.readerFontSize === 'number') {
      this.readerFontSize.set(Math.min(24, Math.max(15, stored.readerFontSize)));
    }
  }

  private persist(): void {
    const prefs: StoredPrefs = {
      themeMode: this.themeMode(),
      accentId: this.accentId(),
      undoSend: this.undoSend(),
      readerFontSize: this.readerFontSize(),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  private applyTheme(): void {
    const mode = this.themeMode();
    const dark = mode === 'dark' || (mode === 'auto' && (this.darkQuery?.matches ?? false));
    this.resolvedTheme.set(dark ? 'dark' : 'light');
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-accent', this.accentId());
  }
}
