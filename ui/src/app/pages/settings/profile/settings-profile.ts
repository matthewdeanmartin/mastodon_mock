import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { AccountField } from '../../../models';

/** Public profile: display name, bio, metadata fields, avatar/header. */
@Component({
  selector: 'app-settings-profile',
  imports: [FormsModule],
  templateUrl: './settings-profile.html',
  styleUrl: './settings-profile.css',
})
export class SettingsProfile implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);

  protected displayName = signal('');
  protected note = signal('');
  protected fields = signal<AccountField[]>([]);
  protected avatar = signal<File | null>(null);
  protected header = signal<File | null>(null);
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.verifyCredentials().subscribe((acc) => {
      this.displayName.set(acc.display_name);
      this.note.set(acc.source?.note ?? acc.note ?? '');
      const fields = (acc.source?.fields ?? acc.fields ?? []).map((f) => ({
        name: f.name,
        value: f.value,
      }));
      // Always offer one empty row to add a new field.
      this.fields.set(fields.length ? fields : [{ name: '', value: '' }]);
    });
  }

  setField(index: number, key: 'name' | 'value', value: string): void {
    this.fields.update((list) => list.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

  addField(): void {
    if (this.fields().length < 4) {
      this.fields.update((list) => [...list, { name: '', value: '' }]);
    }
  }

  removeField(index: number): void {
    this.fields.update((list) => list.filter((_, i) => i !== index));
  }

  onAvatar(event: Event): void {
    this.avatar.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  onHeader(event: Event): void {
    this.header.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  saveProfile(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);

    const form = new FormData();
    form.append('display_name', this.displayName());
    form.append('note', this.note());

    // Profile metadata fields use indexed form keys.
    const fields = this.fields().filter((f) => f.name.trim() || f.value.trim());
    fields.forEach((f, i) => {
      form.append(`fields_attributes[${i}][name]`, f.name);
      form.append(`fields_attributes[${i}][value]`, f.value);
    });

    if (this.avatar()) {
      form.append('avatar', this.avatar()!);
    }
    if (this.header()) {
      form.append('header', this.header()!);
    }

    this.api.updateCredentials(form).subscribe({
      next: (acc) => {
        this.auth.setAccount(acc);
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
