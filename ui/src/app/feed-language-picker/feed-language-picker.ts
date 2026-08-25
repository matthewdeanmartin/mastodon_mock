import { Component, computed, ElementRef, HostListener, inject, signal } from '@angular/core';
import { ClientPrefs, MAX_FEED_LANGUAGES } from '../client-prefs';
import { LANG_NAMES, LangCode } from '../language-detect';
import { KnownLanguages } from '../trend-language-filter';
import { Terminology } from '../terminology';

/**
 * The feed's language control: "All languages", or a chosen handful.
 *
 * Replaces a two-state toggle (all / everything-I-know). That was too coarse
 * for the case this exists to serve: someone following hundreds of accounts and
 * dozens of hashtags who wants *today's* reading to be Esperanto only. They
 * shouldn't have to unfollow anyone, or edit the languages they know, to get
 * there.
 *
 * **Why a dropdown and not a cycling button.** A button that steps through
 * all → en → eo → en+eo costs a feed reload at every intermediate step, so
 * reaching the state you wanted means two or three wasted round trips through
 * states you never wanted to see. A menu commits once.
 *
 * Choices come from the languages the user has declared under
 * Settings → Internationalization ({@link KnownLanguages}), so the menu is
 * short and personal rather than a list of every ISO code. Selection is capped
 * at {@link MAX_FEED_LANGUAGES} — see that constant for why three.
 */
@Component({
  selector: 'app-feed-language-picker',
  templateUrl: './feed-language-picker.html',
  styleUrl: './feed-language-picker.css',
})
export class FeedLanguagePicker {
  /** post/tweet/florp vocabulary, per the Blue setting. */
  protected words = inject(Terminology).words;

  private prefs = inject(ClientPrefs);
  private known = inject(KnownLanguages);
  private host = inject(ElementRef<HTMLElement>);

  protected readonly max = MAX_FEED_LANGUAGES;
  protected readonly open = signal(false);

  /** Every language offerable, named and sorted; the user's own known set. */
  protected readonly options = computed(() =>
    [...this.known.codes()]
      .map((code) => ({ code, name: LANG_NAMES[code as LangCode] ?? code.toUpperCase() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** The currently narrowed-to codes. Empty means "not narrowed". */
  protected readonly selected = computed(() => new Set(this.prefs.feedLanguages()));

  /** True when the feed is unfiltered — the "All languages" row is the active one. */
  protected readonly showingAll = computed(
    () => !this.prefs.hideForeignLangPosts() && !this.prefs.feedLanguages().length,
  );

  /**
   * The button label. Named languages when a small set is chosen, because
   * "Esperanto" tells you what you're looking at and "2 languages" doesn't.
   * Three names would crowd the filter bar, so that one degrades to a count.
   */
  protected readonly label = computed(() => {
    if (this.showingAll()) {
      return 'All';
    }
    const chosen = this.prefs.feedLanguages();
    if (!chosen.length) {
      return 'My languages';
    }
    if (chosen.length > 2) {
      return `${chosen.length} languages`;
    }
    return chosen.map((code) => LANG_NAMES[code as LangCode] ?? code.toUpperCase()).join(' + ');
  });

  /** True when picking another language would exceed the cap. */
  protected atCap(code: string): boolean {
    return !this.selected().has(code) && this.prefs.feedLanguages().length >= this.max;
  }

  protected toggleOpen(): void {
    this.open.update((v) => !v);
  }

  /** Show everything: clears both the narrowing and the filter itself. */
  protected chooseAll(): void {
    this.prefs.setFeedLanguages([]);
    this.prefs.setHideForeignLangPosts(false);
    this.open.set(false);
  }

  /**
   * Add or remove one language. Clearing the last one falls back to "everything
   * I know" rather than to an empty feed — an empty selection that hid every
   * post would look like the app had broken.
   */
  protected toggleLanguage(code: string): void {
    const current = this.prefs.feedLanguages();
    if (current.includes(code)) {
      const next = current.filter((c) => c !== code);
      this.prefs.setFeedLanguages(next);
      if (!next.length) {
        this.prefs.setHideForeignLangPosts(true);
      }
      return;
    }
    if (current.length >= this.max) {
      return;
    }
    this.prefs.setFeedLanguages([...current, code]);
  }

  /** Filter to the known set without naming languages ("My languages"). */
  protected chooseKnown(): void {
    this.prefs.setFeedLanguages([]);
    this.prefs.setHideForeignLangPosts(true);
    this.open.set(false);
  }

  /** A click anywhere else closes the menu, as a dropdown is expected to. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
