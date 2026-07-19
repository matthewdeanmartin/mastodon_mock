import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { AccountField } from '../../../models';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';

/** Public profile: display name, bio, metadata fields, avatar/header. */
@Component({
  selector: 'app-settings-profile',
  imports: [DatePipe, FormsModule],
  templateUrl: './settings-profile.html',
  styleUrl: './settings-profile.css',
})
export class SettingsProfile implements OnInit {
  private api = inject(Api);
  protected auth = inject(Auth);
  protected anonymous = inject(AnonymousAccount);

  protected displayName = signal('');
  protected username = signal('');
  protected note = signal('');
  protected fields = signal<AccountField[]>([]);
  protected avatar = signal<File | null>(null);
  protected header = signal<File | null>(null);
  protected saving = signal(false);
  protected saved = signal(false);
  protected saveError = signal<string | null>(null);
  /**
   * Field label → rel=me verification date. Only the rendered `fields` (not the
   * editable `source.fields`) carry `verified_at`, so match them up by name.
   */
  protected verifiedAt = signal<Record<string, string>>({});

  ngOnInit(): void {
    if (this.auth.isAnonymous) {
      this.loadAccount(this.anonymous.account());
      return;
    }
    this.api.verifyCredentials().subscribe((acc) => this.loadAccount(acc));
  }

  private loadAccount(acc: import('../../../models').Account): void {
    this.displayName.set(acc.display_name);
    this.username.set(acc.username);
    this.note.set(acc.source?.note ?? acc.note ?? '');
    const fields = (acc.source?.fields ?? acc.fields ?? []).map((f) => ({
      name: f.name,
      value: f.value,
    }));
    this.fields.set(fields.length ? fields : [{ name: '', value: '' }]);
    const verified: Record<string, string> = {};
    for (const f of acc.fields ?? []) {
      if (f.verified_at) {
        verified[f.name] = f.verified_at;
      }
    }
    this.verifiedAt.set(verified);
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
    this.saveError.set(null);

    if (this.auth.isAnonymous) {
      void this.saveAnonymousProfile();
      return;
    }

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

  private async saveAnonymousProfile(): Promise<void> {
    try {
      const acc = await this.anonymous.updateProfile(
        {
          displayName: this.displayName(),
          username: this.username(),
          note: this.note(),
          fields: this.fields(),
        },
        this.avatar(),
        this.header(),
      );
      this.auth.setAccount(acc);
      this.loadAccount(acc);
      this.avatar.set(null);
      this.header.set(null);
      this.saved.set(true);
    } catch (error) {
      this.saveError.set(
        error instanceof Error ? error.message : 'Could not save the local profile.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  resetAnonymousProfile(): void {
    this.anonymous.resetIdentity();
    const acc = this.anonymous.account();
    this.auth.setAccount(acc);
    this.loadAccount(acc);
    this.saved.set(true);
    this.saveError.set(null);
  }
}
