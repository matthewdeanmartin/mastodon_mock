import { Component, computed, input, output, signal } from '@angular/core';
import type { AdoptionChoice } from '../../../../providers/account/collection-adoption';
import type { AdoptableCollection } from '../../../../providers/account/collection-adoption-runner';

/**
 * "You have data in both places — which wins?"
 *
 * Shown when a collection's sync is switched on and both this browser and the
 * account hold something. Unlike the welcome dialog this one **can** be
 * cancelled, because there is a real third answer: leave the toggle off and
 * decide later. A modal that forces an irreversible data decision on the spot is
 * how people lose things.
 *
 * ## Two answers, and the one that is missing
 *
 * Merge and replace. There is deliberately no "upload mine over theirs" —
 * that direction destroys data belonging to a browser the user is not looking
 * at, and doing it safely needs per-item history and causality. The dialog says
 * so plainly rather than leaving the absence to be discovered.
 *
 * The consequence is stated in the copy, not buried: on a merge, anything held
 * in both places keeps the account's version.
 */
@Component({
  selector: 'app-adoption-dialog',
  templateUrl: './adoption-dialog.html',
  styleUrl: './adoption-dialog.css',
})
export class AdoptionDialog {
  readonly collection = input.required<AdoptableCollection>();
  readonly localCount = input.required<number>();
  readonly remoteCount = input.required<number>();

  /** The chosen answer. Not emitted if the user backs out. */
  readonly chose = output<AdoptionChoice>();
  /** Backed out: the toggle should go back off. */
  readonly cancelled = output<void>();

  protected readonly busy = signal(false);

  protected readonly noun = computed(() => NOUNS[this.collection()]);

  /**
   * How many of this browser's items a merge would actually add.
   *
   * Not computed here — that needs both sets, and this component is given only
   * counts on purpose so it cannot be tempted into doing the reconciliation
   * itself. The copy therefore says what merge *means* rather than promising a
   * number it cannot verify.
   */
  protected choose(choice: AdoptionChoice): void {
    this.busy.set(true);
    this.chose.emit(choice);
  }

  protected cancel(): void {
    this.cancelled.emit();
  }
}

const NOUNS: Record<AdoptableCollection, string> = {
  trust: 'trusted accounts',
  feeds: 'feed subscriptions',
  lists: 'lists',
};
