import { Component, output, signal } from '@angular/core';

/** Which network a visitor picked, or that they declined to sign in at all. */
export type FirstRunChoice = 'anonymous' | 'mastodon' | 'bluesky';

/**
 * The first-run question, asked over a running app.
 *
 * This modal is the whole point of the front door: the timeline behind it is
 * real and already rendering, so the visitor can see what they are being asked
 * to join before deciding. Its predecessor was a standalone landing page, which
 * showed a stranger a page *about* the app instead of the app.
 *
 * It **blocks**. There is no dismiss, no click-outside and no escape key: the
 * two buttons are the only exits, because "clicked the backdrop" has no honest
 * interpretation as either an answer or a refusal. Step two asks which network,
 * and stays in the modal rather than navigating — leaving the page would throw
 * away the very thing being shown.
 */
@Component({
  selector: 'app-first-run-modal',
  templateUrl: './first-run-modal.html',
  styleUrl: './first-run-modal.css',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'first-run-title',
  },
})
export class FirstRunModal {
  /** Emitted once, when the visitor answers. The host then clears the seed. */
  readonly choose = output<FirstRunChoice>();

  /** `network` is step two: which one. */
  protected step = signal<'welcome' | 'network'>('welcome');

  protected toNetwork(): void {
    this.step.set('network');
  }

  protected back(): void {
    this.step.set('welcome');
  }

  protected pick(choice: FirstRunChoice): void {
    this.choose.emit(choice);
  }
}
