import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';

/** Posting defaults: visibility, sensitive-by-default, language. */
@Component({
  selector: 'app-settings-posting',
  imports: [FormsModule],
  templateUrl: './settings-posting.html',
})
export class SettingsPosting implements OnInit {
  private api = inject(Api);

  protected privacy = signal('public');
  protected sensitive = signal(false);
  protected language = signal('');
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.verifyCredentials().subscribe((acc) => {
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
    form.append('source[privacy]', this.privacy());
    form.append('source[sensitive]', String(this.sensitive()));
    form.append('source[language]', this.language().trim());

    this.api.updateCredentials(form).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
