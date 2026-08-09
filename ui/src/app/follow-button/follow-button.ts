import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Auth } from '../auth';
import { FollowState } from '../follow-state';

/**
 * The follow control for one account, wherever a list of people is rendered.
 *
 * Deliberately small and stateless: everything it knows comes from
 * {@link FollowState}, so a follow made here shows up on every other row for
 * the same person without a refetch, and a list of forty people costs one
 * relationships request rather than forty.
 *
 * ## What it renders, and what it doesn't
 *
 * Nothing at all for an anonymous viewer, for yourself, or before the
 * relationship has resolved. A button that 401s is worse than no button, and a
 * "Follow" that turns out to say "Following" a moment later teaches people not
 * to trust it.
 *
 * `requested` is its own state rather than being folded into "Following":
 * following a locked account is a request they can decline, and telling
 * someone they succeeded at that is simply wrong.
 */
@Component({
  selector: 'app-follow-button',
  imports: [],
  template: `
    @if (visible()) {
      <button
        class="btn btn-sm follow-btn"
        [class.btn-outline]="!connected()"
        [class.following]="connected()"
        type="button"
        [disabled]="busy()"
        [attr.aria-label]="label() + ' ' + handle()"
        (click)="toggle($event)"
      >
        {{ busy() ? '…' : label() }}
      </button>
      @if (error()) {
        <span class="follow-error small" role="alert">{{ error() }}</span>
      }
    }
  `,
  styles: `
    .follow-btn {
      white-space: nowrap;
    }
    /* Hovering an established follow offers to undo it, so the label changes
       under the cursor and the button reads as destructive. */
    .follow-btn.following:hover {
      border-color: var(--danger, #c0392b);
      color: var(--danger, #c0392b);
    }
    .follow-error {
      margin-left: 6px;
      color: var(--danger, #c0392b);
    }
  `,
})
export class FollowButton {
  private auth = inject(Auth);
  private follows = inject(FollowState);

  readonly accountId = input.required<string>();
  /** For the accessible label — "Follow @alice" beats forty identical "Follow"s. */
  readonly handle = input('');

  /** Emitted after a successful write, so a page can re-count or re-sort. */
  readonly changed = output<void>();

  protected readonly error = signal('');

  protected readonly status = computed(() => this.follows.status(this.accountId()));
  protected readonly busy = computed(() => this.follows.busyWith(this.accountId()));

  /** Following or requested — either way, the next click withdraws it. */
  protected readonly connected = computed(
    () => this.status() === 'following' || this.status() === 'requested',
  );

  protected readonly visible = computed(
    () =>
      !this.auth.isAnonymous &&
      this.accountId() !== this.auth.account()?.id &&
      this.status() !== 'unknown',
  );

  protected readonly label = computed(() => {
    switch (this.status()) {
      case 'following':
        return 'Following';
      case 'requested':
        return 'Requested';
      default:
        return 'Follow';
    }
  });

  protected async toggle(event: Event): Promise<void> {
    // These buttons sit inside rows that link to the profile.
    event.stopPropagation();
    event.preventDefault();
    this.error.set('');
    const ok = await this.follows.toggle(this.accountId());
    if (!ok) {
      this.error.set("Couldn't do that — try again.");
      return;
    }
    this.changed.emit();
  }
}
