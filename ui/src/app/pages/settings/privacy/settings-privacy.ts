import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';

/** Privacy and reach: follow approval, discovery opt-in, bot flag. */
@Component({
  selector: 'app-settings-privacy',
  imports: [FormsModule],
  templateUrl: './settings-privacy.html',
})
export class SettingsPrivacy implements OnInit {
  private api = inject(Api);

  protected locked = signal(false);
  protected discoverable = signal(false);
  protected bot = signal(false);
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.verifyCredentials().subscribe((acc) => {
      this.locked.set(acc.locked);
      this.discoverable.set(acc.discoverable ?? false);
      this.bot.set(acc.bot);
    });
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);

    const form = new FormData();
    form.append('locked', String(this.locked()));
    form.append('discoverable', String(this.discoverable()));
    form.append('bot', String(this.bot()));

    this.api.updateCredentials(form).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
