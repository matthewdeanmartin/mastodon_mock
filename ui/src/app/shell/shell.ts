import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from '../api';
import { Auth } from '../auth';

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
        error: () => this.auth.logout(),
      });
    }
  }

  logout(): void {
    this.auth.logout();
    location.assign('login');
  }
}
