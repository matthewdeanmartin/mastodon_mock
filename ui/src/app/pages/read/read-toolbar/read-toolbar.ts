import { Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ClientPrefs,
  ReaderFontFamily,
  ReaderTextAlign,
  ReaderTheme,
  READER_FONT_OPTIONS,
} from '../../../client-prefs';

// i18n reader.toolbar.label: Reader controls
// i18n reader.toolbar.typography: Text
// i18n reader.toolbar.typographyTitle: Text size, typeface and paper
// i18n reader.toolbar.size: Size
// i18n reader.toolbar.smaller: Smaller text
// i18n reader.toolbar.larger: Larger text
// i18n reader.toolbar.typeface: Typeface
// i18n reader.toolbar.paper: Paper
// i18n reader.toolbar.paper.app: Match app
// i18n reader.toolbar.paper.light: Light
// i18n reader.toolbar.paper.sepia: Sepia
// i18n reader.toolbar.paper.dark: Dark
// i18n reader.toolbar.paper.solarized: Solarized
// i18n reader.toolbar.lineHeight: Line height
// i18n reader.toolbar.align: Alignment
// i18n reader.toolbar.align.left: Ragged right
// i18n reader.toolbar.align.justify: Justified
// i18n reader.toolbar.previousPage: Previous page
// i18n reader.toolbar.nextPage: Next page
// i18n reader.toolbar.pageOf: Page {{page}} of {{total}}
// i18n reader.toolbar.pagePosition: {{page}} / {{total}}
// i18n reader.toolbar.minutesLeft: {{minutes}} min left
// i18n reader.toolbar.pageFlip: Pages
// i18n reader.toolbar.pageFlipTitle: Read a page at a time
// i18n reader.toolbar.scroll: Scroll
// i18n reader.toolbar.scrollTitle: Read as one continuous column
// i18n reader.toolbar.library: Library
// i18n reader.toolbar.libraryTitle: Everything you have opened in the reader
// i18n reader.toolbar.librarySoon: Coming in the next release
// i18n reader.toolbar.exit: Exit
// i18n reader.toolbar.exitTitle: Leave the reader
// i18n reader.toolbar.done: Done

/**
 * The reader's own controls.
 *
 * ## Why this is not `reader-toolbar`
 *
 * `reader-toolbar` is the **feed** widget — Home imports it to set typography
 * for a timeline read in reader typography. It is a row of three controls with
 * no document behind it, and it must keep working exactly as it does.
 *
 * This bar belongs to a document: it pages, it reports position, it opens the
 * library, and it is the way out of the reader. Sharing one component would
 * mean a growing pile of inputs to switch half of it off.
 *
 * ## Compact, per the operator
 *
 * Square, flat, borderless — the treatment the home feed's filter row uses
 * (`home.css`), not the app's rounded `.btn` pills. The operator's words: the
 * big rounded ones are obnoxious. That applies to **every** button here, Exit
 * and Library included, which is the part that is easy to get wrong — an exit
 * control feels like it wants emphasis, and giving it any would make it the
 * loudest thing on a page whose whole point is quiet.
 *
 * ## Wider than the text
 *
 * The bar spans its container rather than the measure. A 68ch column is sized
 * for reading prose; the toolbar is not prose, and squeezing controls into a
 * text column wastes the width a wide screen actually has.
 */
@Component({
  selector: 'app-read-toolbar',
  imports: [TranslocoPipe],
  templateUrl: './read-toolbar.html',
  styleUrl: './read-toolbar.css',
})
export class ReadToolbar {
  protected readonly prefs = inject(ClientPrefs);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly readerFonts = READER_FONT_OPTIONS;

  /** 1-based page number, and how many there are. Zero total hides the pager. */
  readonly page = input(0);
  readonly pageCount = input(0);

  /** Minutes of reading left, or null when the document is too short to say. */
  readonly minutesLeft = input<number | null>(null);

  /** Whether the Library button does anything yet. */
  readonly libraryEnabled = input(false);

  /** Whether the library panel is currently open, for the pressed state. */
  readonly libraryOpen = input(false);

  /** False in the RSS pane, where there is nothing to exit to. */
  readonly canExit = input(true);

  readonly previousPage = output<void>();
  readonly nextPage = output<void>();
  readonly toggleLibrary = output<void>();
  readonly exit = output<void>();

  /** Whether the typography popover is showing. */
  protected readonly typographyOpen = signal(false);

  protected readonly paging = computed(() => this.prefs.readerPageFlip() && this.pageCount() > 1);
  protected readonly canPrev = computed(() => this.page() > 1);
  protected readonly canNext = computed(() => this.page() < this.pageCount());

  protected toggleTypography(): void {
    this.typographyOpen.update((open) => !open);
  }

  /**
   * Close the popover when focus or a click leaves the toolbar.
   *
   * A popover that stays open while the reader clicks into the article is a
   * panel covering the text they just asked to read.
   */
  protected closeTypography(): void {
    this.typographyOpen.set(false);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !this.host.nativeElement.contains(next)) {
      this.closeTypography();
    }
  }

  protected bumpFont(delta: number): void {
    this.prefs.setReaderFontSize(this.prefs.readerFontSize() + delta);
  }

  protected setFontFamily(event: Event): void {
    this.prefs.setReaderFontFamily((event.target as HTMLSelectElement).value as ReaderFontFamily);
  }

  protected setTheme(event: Event): void {
    this.prefs.setReaderTheme((event.target as HTMLSelectElement).value as ReaderTheme);
  }

  protected setAlign(event: Event): void {
    this.prefs.setReaderTextAlign((event.target as HTMLSelectElement).value as ReaderTextAlign);
  }

  protected setLineHeight(event: Event): void {
    this.prefs.setReaderLineHeight(Number((event.target as HTMLInputElement).value));
  }

  protected setPageFlip(on: boolean): void {
    this.prefs.setReaderPageFlip(on);
  }
}
