import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { DevUser } from '../../models';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);

  protected token = signal('');
  protected error = signal<string | null>(null);
  protected checking = signal(false);

  protected devUsers = signal<DevUser[]>([]);
  protected working = signal(false);

  protected preset = signal('small');
  protected seeding = signal(false);
  protected seedMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.refreshDevUsers();
  }

  submit(): void {
    const value = this.token().trim();
    if (!value) {
      return;
    }
    this.error.set(null);
    this.checking.set(true);
    this.auth.setToken(value);
    this.api.verifyCredentials().subscribe({
      next: (acc) => {
        this.auth.setAccount(acc);
        this.checking.set(false);
        this.router.navigateByUrl('/home');
      },
      error: () => {
        this.auth.logout();
        this.checking.set(false);
        this.error.set('That token was rejected. Check it and try again.');
      },
    });
  }

  generate(admin: boolean): void {
    this.working.set(true);
    this.api.createDevUser(admin).subscribe({
      next: (user) => {
        this.working.set(false);
        this.use(user);
        this.refreshDevUsers();
      },
      error: () => this.working.set(false),
    });
  }

  /** Bulk-generate a sample cohort, then refresh the dev-user list. */
  seedSample(): void {
    this.seeding.set(true);
    this.seedMessage.set(null);
    this.api.seedSampleData(this.preset()).subscribe({
      next: ({ report }) => {
        this.seeding.set(false);
        this.seedMessage.set(
          `Created ${report.accounts.toLocaleString()} accounts, ` +
            `${report.statuses.toLocaleString()} statuses in ${report.total_seconds.toFixed(2)}s`,
        );
        this.refreshDevUsers();
      },
      error: (err) => {
        this.seeding.set(false);
        this.seedMessage.set(err?.error?.detail ?? 'Seeding failed.');
      },
    });
  }

  refreshDevUsers(): void {
    this.api.listDevUsers().subscribe({
      next: (users) => this.devUsers.set(users),
      error: () => this.devUsers.set([]),
    });
  }

  /** Autofill the token box from a dev user (does not auto-submit). */
  use(user: DevUser): void {
    this.token.set(user.access_token);
    this.error.set(null);
  }
}
