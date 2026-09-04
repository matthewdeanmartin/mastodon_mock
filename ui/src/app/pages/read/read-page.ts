import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ClientPrefs } from '../../client-prefs';
import { ReadingZen } from '../../reading-zen';
import { ThreadLoader } from './thread-loader';
import { ReaderCore } from './reader-core/reader-core';
import { LibraryPanel } from './library-panel/library-panel';
import { readerChain } from './reader-document';

// i18n reader.page.loading: Opening…
// i18n reader.page.notFound: We couldn't open that to read.
// i18n reader.page.viewThread: View as a thread
// i18n reader.page.backToRss: Return to RSS

/**
 * The reader page: one document, the whole screen.
 *
 * ## Why this is a page and not a mode
 *
 * Reader mode used to be `?reader=1` on the thread page — a signal flipped
 * inside a component whose actual job is rendering a conversation. That was
 * fine while reading was a toggle. It stops working the moment reading has
 * state of its own (a library, a position, notes, highlights), because all of
 * it would have to live inside `thread.ts` and then be extracted later, with
 * the data already in people's browsers.
 *
 * See `sprint/kindle-0-overview.md`.
 *
 * ## Zen
 *
 * A `full` reading-zen hold: rails, header and footer all go. Taken on init and
 * released in `ngOnDestroy` — never in the Exit handler, because a browser Back
 * button never calls it, and a leaked hold means an app with no navigation.
 *
 * There is no control here to bring the chrome back. The way out is Exit, and
 * that is deliberate: a reader who can toggle the app's furniture back on
 * mid-article is a reader deciding whether to look at the furniture.
 */
@Component({
  selector: 'app-read-page',
  imports: [RouterLink, TranslocoPipe, ReaderCore, LibraryPanel],
  templateUrl: './read-page.html',
  styleUrl: './read-page.css',
  providers: [ThreadLoader],
})
export class ReadPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private readingZen = inject(ReadingZen);

  protected readonly prefs = inject(ClientPrefs);
  protected readonly loader = inject(ThreadLoader);

  private core = viewChild(ReaderCore);

  /** Releases the hold on the app's chrome. Non-null for this page's lifetime. */
  private releaseZen: (() => void) | null = null;

  /** The id currently being read, for the "view as thread" link. */
  protected readonly currentId = signal('');

  /** The author's own chain: the document. */
  protected readonly chain = computed(() => readerChain(this.loader.thread(), this.currentId()));

  /**
   * Whether the library sheet is showing.
   *
   * Off by default, per the brief, and remembered — someone who reads with the
   * library open is telling us how they like to read, not making a one-off
   * request. The preference lives in `ClientPrefs` rather than the library
   * store: it is view state, and the store is shaped for a later sync.
   */
  protected readonly libraryOpen = this.prefs.readerLibraryOpen;

  protected toggleLibrary(): void {
    this.prefs.setReaderLibraryOpen(!this.libraryOpen());
  }

  ngOnInit(): void {
    this.releaseZen = this.readingZen.hold('full');
    // A plain listener rather than `@HostListener`: the reader's keys are
    // document-wide (the focus is usually in the article, not on the host), and
    // registering here keeps the add and the remove next to each other.
    document.addEventListener('keydown', this.onKeydown);

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id') ?? '';
      if (!id || id === this.currentId()) {
        return;
      }
      this.currentId.set(id);
      this.loader.load(id);
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.onKeydown);
    this.releaseZen?.();
    this.releaseZen = null;
    this.loader.destroy();
  }

  /**
   * Leave the reader.
   *
   * Back rather than a fixed destination when there is history to go back to:
   * the reader is reached from a feed, a thread, a search or the RSS pane, and
   * sending everyone to the thread view would strand four of those five.
   * Falls back to the thread when this page was opened cold (a shared link).
   */
  protected exit(): void {
    if (history.length > 1) {
      history.back();
      return;
    }
    void this.router.navigate(['/statuses', this.currentId()], {
      queryParams: { reader: '0' },
    });
  }

  /**
   * Page-turning keys.
   *
   * On this page rather than in `hotkeys.ts`, the same way `StatusCard`'s
   * per-status keys are: these are bindings of a surface, not of the app. They
   * stop propagation so the global map's `j`/`k`/`/` never fire underneath.
   *
   * Ignored while focus is in a form control, or when a modifier is held — a
   * reader using ⌘← to go back should go back.
   */
  onKeydown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    const core = this.core();
    const paging = this.prefs.readerPageFlip();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.exit();
        return;
      case 'ArrowRight':
      case 'PageDown':
        if (!paging || !core) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        core.nextPage();
        return;
      case 'ArrowLeft':
      case 'PageUp':
        if (!paging || !core) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        core.prevPage();
        return;
      case ' ':
        if (!paging || !core) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          core.prevPage();
        } else {
          core.nextPage();
        }
        return;
      case 'Home':
      case 'End':
        if (!paging || !core) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        core.goToPage(event.key === 'Home' ? 1 : Number.MAX_SAFE_INTEGER);
        return;
      default:
        return;
    }
  };
}
