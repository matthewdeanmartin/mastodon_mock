import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';

/** Account: username, simulated password change, sessions note. */
@Component({
  selector: 'app-settings-account',
  imports: [FormsModule],
  templateUrl: './settings-account.html',
})
export class SettingsAccount implements OnInit {
  private api = inject(Api);

  protected acct = signal('');
  protected currentPassword = signal('');
  protected newPassword = signal('');
  protected confirmPassword = signal('');
  protected passwordError = signal('');
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.verifyCredentials().subscribe((acc) => {
      this.acct.set(acc.acct);
    });
  }

  protected changePassword(): void {
    this.saved.set(false);
    if (this.newPassword() !== this.confirmPassword()) {
      this.passwordError.set('New password and confirmation do not match.');
      return;
    }
    this.passwordError.set('');
    // The mock has no password store; the "change" succeeds client-side only.
    this.currentPassword.set('');
    this.newPassword.set('');
    this.confirmPassword.set('');
    this.saved.set(true);
  }
}
