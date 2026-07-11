import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, AccountField } from '../../models';

type Tab = 'profile' | 'mutes' | 'blocks' | 'requests';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);

  protected tab = signal<Tab>('profile');

  // Profile form.
  protected displayName = signal('');
  protected note = signal('');
  protected locked = signal(false);
  protected bot = signal(false);
  protected fields = signal<AccountField[]>([]);
  protected avatar = signal<File | null>(null);
  protected header = signal<File | null>(null);
  protected saving = signal(false);
  protected saved = signal(false);

  // Relationship lists.
  protected mutes = signal<Account[]>([]);
  protected blocks = signal<Account[]>([]);
  protected requests = signal<Account[]>([]);
  protected listLoading = signal(false);

  ngOnInit(): void {
    this.loadProfile();
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    if (tab === 'mutes' && !this.mutes().length) {
      this.loadList('mutes');
    } else if (tab === 'blocks' && !this.blocks().length) {
      this.loadList('blocks');
    } else if (tab === 'requests' && !this.requests().length) {
      this.loadList('requests');
    }
  }

  private loadProfile(): void {
    this.api.verifyCredentials().subscribe((acc) => {
      this.displayName.set(acc.display_name);
      this.note.set(acc.source?.note ?? acc.note ?? '');
      this.locked.set(acc.locked);
      this.bot.set(acc.bot);
      const fields = (acc.source?.fields ?? acc.fields ?? []).map((f) => ({
        name: f.name,
        value: f.value,
      }));
      // Always offer one empty row to add a new field.
      this.fields.set(fields.length ? fields : [{ name: '', value: '' }]);
    });
  }

  private loadList(which: 'mutes' | 'blocks' | 'requests'): void {
    this.listLoading.set(true);
    const call =
      which === 'mutes'
        ? this.api.mutes()
        : which === 'blocks'
          ? this.api.blocks()
          : this.api.followRequests();
    call.subscribe({
      next: (accounts) => {
        this[which].set(accounts);
        this.listLoading.set(false);
      },
      error: () => this.listLoading.set(false),
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
    form.append('locked', String(this.locked()));
    form.append('bot', String(this.bot()));

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

  unmute(acc: Account): void {
    this.api.unmuteAccount(acc.id).subscribe(() => {
      this.mutes.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }

  unblock(acc: Account): void {
    this.api.unblockAccount(acc.id).subscribe(() => {
      this.blocks.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }

  authorize(acc: Account): void {
    this.api.authorizeFollowRequest(acc.id).subscribe(() => {
      this.requests.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }

  reject(acc: Account): void {
    this.api.rejectFollowRequest(acc.id).subscribe(() => {
      this.requests.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }
}
