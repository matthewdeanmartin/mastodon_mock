import { Component, computed, inject, input, output, signal } from '@angular/core';
import { HumanTimePipe } from '../../../human-time.pipe';
import { DraftItem } from '../../drafts/draft-items';
import { WriteColumn, WriteWorkspace } from '../write-workspace';
import {
  BOARD_COLUMNS,
  columnHint,
  columnLabel,
  groupByColumn,
  isDerivedColumn,
  movableColumns,
} from './board-columns';

/**
 * The kanban board: everything unpublished, by how far along it is.
 *
 * `/write`'s draft list is time-sorted, which answers "what was I doing
 * yesterday" and not "what is nearly done". This answers the second.
 *
 * ## Why this is a component and not part of the page
 *
 * Where the board lives is **not settled**. Today it opens as a panel inside
 * `/write`; it may yet turn out there is not the real estate and it needs a
 * screen of its own. So its entire contract with the outside world is the four
 * members below — items in, "open this" and "close me" out — and it injects
 * only {@link WriteWorkspace}, for the column it reads and writes.
 *
 * Mounting it at a route later must be: add a route, pass it the same items.
 * If moving it means touching anything in here, the boundary was drawn wrong.
 * Its spec mounts it standalone for exactly that reason.
 */
@Component({
  selector: 'app-write-board',
  imports: [HumanTimePipe],
  templateUrl: './write-board.html',
  styleUrl: './write-board.css',
})
export class WriteBoard {
  private workspace = inject(WriteWorkspace);

  readonly items = input.required<readonly DraftItem[]>();
  /** Highlights whichever draft the editor currently holds. */
  readonly currentKey = input<string | null>(null);
  /** "Put this one in the editor." */
  readonly opened = output<DraftItem>();
  /** "I am done looking." */
  readonly closed = output<void>();

  protected readonly label = columnLabel;
  protected readonly hint = columnHint;
  protected readonly derived = isDerivedColumn;
  protected readonly moveTargets = movableColumns();

  /** Which card's "Move to…" menu is open, by key. */
  protected menuFor = signal<string | null>(null);
  /** The last move, announced for screen readers. */
  protected announcement = signal('');

  protected columns = computed(() =>
    groupByColumn(this.items(), (key) => this.workspace.column(key)),
  );

  protected count(column: WriteColumn): number {
    return this.columns().find((c) => c.id === column)?.items.length ?? 0;
  }

  protected open(item: DraftItem): void {
    this.opened.emit(item);
  }

  protected close(): void {
    this.closed.emit();
  }

  protected toggleMenu(item: DraftItem): void {
    this.menuFor.update((key) => (key === item.key ? null : item.key));
  }

  /**
   * Move a card, by menu or by drop.
   *
   * Instant and local — no request, no undo. The cost of a wrong move is one
   * more move, which is cheaper than an undo affordance nobody would find.
   *
   * Refuses anything involving Scheduled in either direction: a draft becomes
   * scheduled by *being scheduled* (the publish wizard's last step, or the park
   * action on /drafts), and dragging a card out of Scheduled would claim to
   * cancel a publish it has not cancelled.
   */
  protected move(item: DraftItem, to: WriteColumn): void {
    this.menuFor.set(null);
    if (isDerivedColumn(to)) {
      this.announce(`${this.label(to)} is set by scheduling a post, not by moving it here.`);
      return;
    }
    if (item.kind === 'scheduled') {
      this.announce('A scheduled post stays in Scheduled until it publishes or is cancelled.');
      return;
    }
    this.workspace.setColumn(item.key, to);
    this.announce(`Moved to ${this.label(to)}.`);
  }

  // ------------------------------------------------------------ drag and drop
  //
  // Built on top of the keyboard path rather than beside it: `move()` is the
  // one place a card changes column, so the two routes cannot disagree.

  protected dragging = signal<string | null>(null);
  protected dragOver = signal<WriteColumn | null>(null);

  protected onDragStart(item: DraftItem, event: DragEvent): void {
    this.dragging.set(item.key);
    event.dataTransfer?.setData('text/plain', item.key);
  }

  protected onDragEnd(): void {
    this.dragging.set(null);
    this.dragOver.set(null);
  }

  protected onDragOver(column: WriteColumn, event: DragEvent): void {
    if (isDerivedColumn(column)) {
      return;
    }
    // Without this the drop never fires — the default is "reject".
    event.preventDefault();
    this.dragOver.set(column);
  }

  protected onDrop(column: WriteColumn, event: DragEvent): void {
    event.preventDefault();
    const key = this.dragging() ?? event.dataTransfer?.getData('text/plain') ?? null;
    this.dragging.set(null);
    this.dragOver.set(null);
    const item = key ? this.items().find((i) => i.key === key) : undefined;
    if (item) {
      this.move(item, column);
    }
  }

  /**
   * Say what happened.
   *
   * A move is a purely visual change, so without this it is invisible to
   * exactly the users who most need the keyboard path.
   */
  private announce(message: string): void {
    this.announcement.set(message);
  }

  protected readonly boardColumns = BOARD_COLUMNS;
}
