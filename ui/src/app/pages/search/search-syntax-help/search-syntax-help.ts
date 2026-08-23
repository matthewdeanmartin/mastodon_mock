import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

interface SyntaxRow {
  /** The operator as you would type it. */
  syntax: string;
  label: string;
  /** A worked example, when the operator alone doesn't make the shape obvious. */
  example?: string;
}

interface SyntaxGroup {
  title: string;
  /** One sentence of context above the table, where the group needs it. */
  note?: string;
  rows: SyntaxRow[];
}

/** Which network's operators to document. */
export type SyntaxNetwork = 'mastodon' | 'bluesky';

/**
 * The operator reference, sourced from `mastodon-query-serializer.ts`.
 *
 * These are exactly the operators the Advanced form emits, and no more. That
 * matters: an operator Mastodon does not honour fails *silently* by returning
 * more results than asked for, so documenting a hopeful one here would teach
 * people to write queries that quietly lie to them (see the DSL trust bet in
 * `sprint/search-2-serializer-and-explain.md`).
 */
const GROUPS: SyntaxGroup[] = [
  {
    title: 'Words',
    note: 'Bare words match loosely. The operators tighten that up.',
    rows: [
      { syntax: '+word', label: 'The word must appear', example: '+rust +compiler' },
      { syntax: '-word', label: 'The word must not appear', example: 'rust -gamedev' },
      {
        syntax: '"exact phrase"',
        label: 'The words must appear together',
        example: '"borrow checker"',
      },
    ],
  },
  {
    title: 'Who and when',
    rows: [
      {
        syntax: 'from:@user@host',
        label: 'Posted by this account',
        example: 'from:@Gargron@mastodon.social',
      },
      {
        syntax: 'after:YYYY-MM-DD',
        label: 'Posted on or after this date',
        example: 'after:2026-01-01',
      },
      {
        syntax: 'before:YYYY-MM-DD',
        label: 'Posted on or before this date',
        example: 'before:2026-07-01',
      },
      {
        syntax: 'language:xx',
        label: 'Written in this language (two-letter code)',
        example: 'language:en',
      },
    ],
  },
  {
    title: 'What is in the post',
    rows: [
      { syntax: 'has:media', label: 'Has an image, video or audio attachment' },
      { syntax: 'has:poll', label: 'Has a poll' },
      { syntax: 'is:reply', label: 'Is a reply to another post' },
      { syntax: '-is:reply', label: 'Is not a reply' },
      { syntax: 'is:sensitive', label: 'Is marked sensitive' },
      { syntax: '-is:sensitive', label: 'Is not marked sensitive' },
    ],
  },
  {
    title: 'Where to look',
    note: 'Without one of these, the server picks its own default scope.',
    rows: [
      { syntax: 'in:public', label: 'Search all public posts' },
      { syntax: 'in:library', label: 'Search only posts you wrote or interacted with' },
    ],
  },
];

/**
 * Bluesky's operators, sourced from `bluesky-query-serializer.ts`.
 *
 * Same rule as the Mastodon list and for the same reason: these are exactly the
 * ones `app.bsky.feed.searchPosts` takes as parameters. Bluesky's failure mode
 * is worse than Mastodon's, in fact — an operator it does not know is not
 * ignored, it is treated as a *search word*, so `has:media` quietly searches for
 * the literal text "has:media" and returns nothing.
 */
const BLUESKY_GROUPS: SyntaxGroup[] = [
  {
    title: 'Words',
    note: 'Bare words all have to match. Quotes make them match as a phrase.',
    rows: [
      { syntax: 'word word', label: 'All of these words must appear', example: 'rust compiler' },
      {
        syntax: '"exact phrase"',
        label: 'The words must appear together',
        example: '"borrow checker"',
      },
    ],
  },
  {
    title: 'Who and when',
    rows: [
      {
        syntax: 'from:handle',
        label: 'Posted by this account',
        example: 'from:pfrazee.com',
      },
      {
        syntax: 'mentions:handle',
        label: 'Mentions this account',
        example: 'mentions:jay.bsky.team',
      },
      {
        syntax: 'since:YYYY-MM-DD',
        label: 'Posted on or after this date',
        example: 'since:2026-01-01',
      },
      {
        syntax: 'until:YYYY-MM-DD',
        label: 'Posted before this date',
        example: 'until:2026-07-01',
      },
      {
        syntax: 'lang:xx',
        label: 'Written in this language (two-letter code)',
        example: 'lang:en',
      },
    ],
  },
  {
    title: 'Tags and links',
    note: 'Two tags narrow the results — they must both be present, not either one.',
    rows: [
      { syntax: '#tag', label: 'Tagged with this hashtag', example: '#angular #typescript' },
      { syntax: 'tag:name', label: 'The same thing, written out' },
      {
        syntax: 'domain:host',
        label: 'Links to this domain',
        example: 'domain:github.com',
      },
      {
        syntax: 'url:address',
        label: 'Links to this exact URL',
        example: 'url:https://example.com/post',
      },
    ],
  },
];

/**
 * The "Syntax?" cheat-sheet for the search bar, in two presentations.
 *
 * As a dialog (the default) it is deliberately the same shape as the
 * keyboard-shortcuts help: this is the second "here is what you can type"
 * reference in the app, and two references that look alike are one thing to
 * learn instead of two.
 *
 * With `[embedded]="true"` the same content renders bare, with no overlay and
 * no Close button, for the search page's idle state. That state used to show
 * trending posts, which filled the space without answering the question someone
 * staring at an empty search box actually has. One component rather than two
 * because the operator list must not be able to drift between them — it is
 * sourced from `mastodon-query-serializer.ts` and a stale copy would document
 * operators that silently do nothing.
 */
@Component({
  selector: 'app-search-syntax-help',
  imports: [NgTemplateOutlet],
  template: `
    @if (embedded()) {
      <section class="embedded" aria-labelledby="search-syntax-title">
        <ng-container [ngTemplateOutlet]="body" />
      </section>
    } @else {
      <div
        class="overlay"
        role="presentation"
        tabindex="-1"
        (click)="closed.emit()"
        (keyup.escape)="closed.emit()"
      >
        <div
          class="dialog"
          role="dialog"
          aria-labelledby="search-syntax-title"
          (click)="$event.stopPropagation()"
          (keyup)="$event.stopPropagation()"
        >
          <ng-container [ngTemplateOutlet]="body" />
          <div class="actions">
            <button class="btn btn-outline" type="button" (click)="closed.emit()">Close</button>
          </div>
        </div>
      </div>
    }

    <ng-template #body>
      <h3 id="search-syntax-title">
        {{ network() === 'bluesky' ? 'Bluesky search syntax' : 'Mastodon search syntax' }}
      </h3>
      <p class="muted note">
        These work in a <strong>post</strong> search — and in an
        <strong>account</strong> search, which runs this same post search as one of its two halves
        and groups the hits by author (they narrow that half only; names and bios are matched as
        plain text). Hashtag search matches plain text only.
      </p>
      <div class="groups">
        @for (group of groups(); track group.title) {
          <section>
            <h4>{{ group.title }}</h4>
            @if (group.note) {
              <p class="muted group-note">{{ group.note }}</p>
            }
            <table>
              <tbody>
                @for (row of group.rows; track row.syntax) {
                  <tr>
                    <td class="syntax">
                      <code>{{ row.syntax }}</code>
                    </td>
                    <td>
                      {{ row.label }}
                      @if (row.example) {
                        <span class="example"
                          ><code>{{ row.example }}</code></span
                        >
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      </div>
      @if (network() === 'bluesky') {
        <p class="muted note footer-note">
          Combine them freely, separated by spaces — everything you write must match:
          <code>rust from:pfrazee.com since:2026-01-01 #compiler</code>. An operator Bluesky doesn't
          recognise is treated as a <em>search word</em> rather than ignored, so a misspelled one
          usually returns nothing at all.
        </p>
      } @else {
        <p class="muted note footer-note">
          Combine them freely, separated by spaces — everything you write must match:
          <code>+rust from:&#64;a&#64;b.social after:2026-01-01 -is:reply</code>. Anything the
          server doesn't recognise is quietly ignored, so if a query returns more than you expected,
          check the spelling of the operator.
        </p>
      }
    </ng-template>
  `,
  styles: `
    /* Embedded: no overlay, no card. The idle search page is already a panel,
       and nesting a second bordered box inside it reads as a modal that failed
       to open. h3 drops to the size of a section heading for the same reason. */
    .embedded h3 {
      font-size: 1.05em;
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 110;
      padding: 16px;
    }
    .dialog {
      background: var(--col-bg);
      color: var(--text);
      border-radius: 16px;
      padding: 24px;
      width: 720px;
      max-width: 100%;
      max-height: 85vh;
      overflow-y: auto;
    }
    h3 {
      margin: 0 0 4px;
    }
    .note {
      margin: 0 0 16px;
      font-size: 0.9em;
    }
    .groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    h4 {
      margin: 0 0 4px;
    }
    .group-note {
      margin: 0 0 8px;
      font-size: 0.85em;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.9em;
    }
    td {
      padding: 3px 8px 3px 0;
      vertical-align: top;
    }
    .syntax {
      white-space: nowrap;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .syntax code {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.95em;
    }
    .example {
      display: block;
      margin-top: 2px;
      font-size: 0.9em;
      opacity: 0.75;
    }
    .footer-note {
      margin: 16px 0 0;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
  `,
})
export class SearchSyntaxHelp {
  /** Render bare, without the overlay or the Close button. */
  readonly embedded = input(false);

  /**
   * Whose operators to document.
   *
   * One component rather than two, for the same reason the Mastodon list is
   * generated from one constant: the two dialects are similar enough that two
   * separate references would be read as one and misremembered. Showing the same
   * reference in the same shape, with the operators swapped, makes the
   * differences — `after:` vs `since:`, `+word` vs bare words — visible.
   */
  readonly network = input<SyntaxNetwork>('mastodon');

  readonly closed = output<void>();

  protected readonly groups = computed(() =>
    this.network() === 'bluesky' ? BLUESKY_GROUPS : GROUPS,
  );
}
