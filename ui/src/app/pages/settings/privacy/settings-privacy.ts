import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { ClientPrefs } from '../../../client-prefs';
import { POSTING_LANGUAGE_OPTIONS } from '../../../language-detect';

/**
 * Privacy: who can see the account, who sees each post, and what gets counted.
 *
 * The posting rows here are the same settings the Writing page shows, on
 * purpose — "default visibility" is a privacy question and a publishing
 * question at once, and there is no reason to make the user guess which shelf
 * we put it on. Both pages PATCH the same credentials fields.
 */
@Component({
  selector: 'app-settings-privacy',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-privacy.html',
})
export class SettingsPrivacy implements OnInit {
  private api = inject(Api);
  protected prefs = inject(ClientPrefs);

  protected locked = signal(false);
  protected discoverable = signal(false);
  protected bot = signal(false);
  protected privacy = signal('public');
  protected sensitive = signal(false);
  protected language = signal('');
  protected readonly postingLanguageOptions = POSTING_LANGUAGE_OPTIONS;
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.verifyCredentials().subscribe((acc) => {
      this.locked.set(acc.locked);
      this.discoverable.set(acc.discoverable ?? false);
      this.bot.set(acc.bot);
      this.privacy.set(acc.source?.privacy ?? 'public');
      this.sensitive.set(acc.source?.sensitive ?? false);
      this.language.set(acc.source?.language ?? '');
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
    form.append('source[privacy]', this.privacy());
    form.append('source[sensitive]', String(this.sensitive()));
    form.append('source[language]', this.language().trim());

    this.api.updateCredentials(form).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.prefs.setDefaultVisibility(this.privacy());
        if (this.language()) this.prefs.addKnownLanguage(this.language());
      },
      error: () => this.saving.set(false),
    });
  }
}
