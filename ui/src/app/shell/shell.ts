import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from '../api';
import { Auth, Session } from '../auth';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell implements OnInit {
  protected auth = inject(Auth);
  private api = inject(Api);

  /** Whether the current account holds a staff role (drives the Admin nav link). */
  protected isStaff = computed(() => {
    const role = this.auth.account()?.role;
    return !!role && role.name !== '';
  });

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
    if (session.token === this.auth.token()) {
      return;
    }
    this.auth.switchTo(session.token);
    this.api.verifyCredentials().subscribe({
      next: (acc) => this.auth.setAccount(acc),
      error: () => this.auth.removeSession(session.token),
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
