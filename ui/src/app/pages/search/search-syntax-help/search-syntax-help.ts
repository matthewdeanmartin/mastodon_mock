import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';

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
      <h3 id="search-syntax-title">Search syntax</h3>
      <p class="muted note">
        These work in a <strong>post</strong> search. Account and hashtag searches match plain text
        only — operators there are treated as words.
      </p>
      <div class="groups">
        @for (group of groups; track group.title) {
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
      <p class="muted note footer-note">
        Combine them freely, separated by spaces — everything you write must match:
        <code>+rust from:&#64;a&#64;b.social after:2026-01-01 -is:reply</code>. Anything the server
        doesn't recognise is quietly ignored, so if a query returns more than you expected, check
        the spelling of the operator.
      </p>
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
  readonly closed = output<void>();
  protected readonly groups = GROUPS;
}
