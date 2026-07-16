import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ImportFollows, parseHandles } from '../../import-follows';

/**
 * Onboarding "Phase 1": a home timeline is only as good as who you follow, and a
 * brand-new account follows nobody. This page bulk-imports a follow list entirely
 * client-side (paste or upload → resolve → follow one at a time), and points at
 * directories for discovering accounts.
 */
@Component({
  selector: 'app-find-people',
  imports: [FormsModule, RouterLink],
  templateUrl: './find-people.html',
  styleUrl: './find-people.css',
})
export class FindPeople {
  protected importer = inject(ImportFollows);

  /** True when hosted inside another page (e.g. search's empty state): no page title. */
  readonly embedded = input(false);

  protected pasted = signal('');
  protected fileName = signal<string | null>(null);
  protected parseNote = signal<string | null>(null);

  protected doneCount = computed(
    () =>
      this.importer
        .rows()
        .filter(
          (r) => r.status !== 'pending' && r.status !== 'resolving' && r.status !== 'following',
        ).length,
  );

  protected followedCount = computed(
    () => this.importer.rows().filter((r) => r.status === 'followed').length,
  );

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.fileName.set(file.name);
    file.text().then((text) => {
      this.pasted.set(text);
      this.preview();
    });
    input.value = '';
  }

  preview(): void {
    const handles = parseHandles(this.pasted());
    this.importer.reset();
    this.importer.load(handles);
    this.parseNote.set(
      handles.length
        ? `Found ${handles.length} account${handles.length === 1 ? '' : 's'} to follow.`
        : 'No handles found — expected @user@host, profile URLs, or a Mastodon CSV export.',
    );
  }

  start(): void {
    void this.importer.start();
  }

  clear(): void {
    this.pasted.set('');
    this.fileName.set(null);
    this.parseNote.set(null);
    this.importer.reset();
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'pending':
        return 'waiting';
      case 'resolving':
        return 'looking up…';
      case 'following':
        return 'following…';
      case 'followed':
        return 'followed ✓';
      case 'not_found':
        return 'not found';
      default:
        return 'failed';
    }
  }
}
