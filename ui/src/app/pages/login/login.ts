import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);

  protected token = signal('');
  protected error = signal<string | null>(null);
  protected checking = signal(false);

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
}
