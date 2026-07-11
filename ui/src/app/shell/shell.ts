import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from '../api';
import { Auth, Session } from '../auth';
import { environment } from '../../environments/environment';
import { LeftRail } from './left-rail/left-rail';
import { RightRail } from './right-rail/right-rail';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LeftRail, RightRail],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell implements OnInit {
  protected auth = inject(Auth);
  private api = inject(Api);

  /** Build flavor: drives the brand and whether mock-only nav links are shown. */
  protected brand = environment.brand;
  protected mockTooling = environment.mockTooling;

  /** Whether the current account holds a staff role (drives the Admin nav link). */
  protected isStaff = computed(() => {
    const role = this.auth.account()?.role;
    return !!role && role.name !== '';
  });

  /** Transient, non-blocking message (e.g. a failed account switch). null = hidden. */
  protected toast = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => this.toast.set(null), 6000);
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  ngOnInit(): void {
    if (!this.auth.account()) {
      this.api.verifyCredentials().subscribe({
        next: (acc) => this.auth.setAccount(acc),
        error: () => {
          // Token was rejected: drop it (falling back to another saved account if any).
          this.auth.logout();
          if (!this.auth.isAuthenticated) {
            location.assign('login');
          }
        },
      });
    }
  }

  /** Switch to a saved account, then re-verify it (refreshes the role/snapshot). */
  switchTo(session: Session): void {
    const previous = this.auth.token();
    if (session.token === previous) {
      return;
    }
    this.auth.switchTo(session.token);
    this.api.verifyCredentials().subscribe({
      next: (acc) => this.auth.setAccount(acc),
      error: () => {
        // The token was rejected by its instance. Don't silently delete the account —
        // revert to where we were and tell the user (non-blocking toast).
        const name = session.account?.display_name || session.account?.username || 'that account';
        if (previous) {
          this.auth.switchTo(previous);
        }
        this.showToast(
          `Couldn't switch to ${name} — its session may have expired. Sign in again to refresh it.`,
        );
      },
    });
  }

  addAccount(): void {
    location.assign('login');
  }

  /** Sign out of just the active account; fall back to another if one remains. */
  logout(): void {
    this.auth.logout();
    if (!this.auth.isAuthenticated) {
      location.assign('login');
    }
  }
}
