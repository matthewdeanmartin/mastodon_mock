import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../api';
import { ComposeOptions, MediaAttachment, Status } from '../models';

const VISIBILITIES = ['public', 'unlisted', 'private', 'direct'] as const;

/** Poll expiry presets (label → seconds). */
const POLL_EXPIRY = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 259200 },
  { label: '7 days', seconds: 604800 },
];

/** A media attachment that has been uploaded and is pending attachment to a post. */
interface PendingMedia {
  media: MediaAttachment;
  description: string;
}

@Component({
  selector: 'app-compose',
  imports: [FormsModule],
  templateUrl: './compose.html',
  styleUrl: './compose.css',
})
export class Compose {
  private api = inject(Api);

  readonly inReplyToId = input<string | undefined>(undefined);
  /** When set, the composed status quotes this status id. */
  readonly quotedStatusId = input<string | undefined>(undefined);
  readonly placeholder = input('What is happening?');
  /** Optional pre-seeded body (e.g. @mentions for a direct reply). */
  readonly initialText = input('');
  /** Optional initial visibility (e.g. 'direct' for a conversation reply). */
  readonly initialVisibility = input('public');
  readonly posted = output<Status>();

  protected readonly visibilities = VISIBILITIES;
  protected readonly pollExpiry = POLL_EXPIRY;

  protected text = signal('');
  protected submitting = signal(false);

  // Visibility + content warning.
  protected visibility = signal<string>('public');

  constructor() {
    // Seed the composer from inputs once they resolve. Runs again only if the
    // container swaps the bound conversation (new initial values).
    effect(() => {
      this.text.set(this.initialText());
      this.visibility.set(this.initialVisibility());
    });
  }
  protected cwOpen = signal(false);
  protected spoilerText = signal('');
  protected sensitive = signal(false);

  // Media.
  protected media = signal<PendingMedia[]>([]);
  protected uploading = signal(false);

  // Poll.
  protected pollOpen = signal(false);
  protected pollOptions = signal<string[]>(['', '']);
  protected pollMultiple = signal(false);
  protected pollExpiresIn = signal<number>(86400);

  /** Media and polls are mutually exclusive, matching Mastodon. */
  protected canAttachMedia = computed(() => !this.pollOpen());
  protected canAddPoll = computed(() => this.media().length === 0);

  protected canSubmit = computed(() => {
    if (this.submitting() || this.uploading()) {
      return false;
    }
    const hasText = !!this.text().trim();
    const hasMedia = this.media().length > 0;
    const hasPoll = this.pollOpen() && this.pollOptions().filter((o) => o.trim()).length >= 2;
    return hasText || hasMedia || hasPoll;
  });

  toggleCw(): void {
    this.cwOpen.update((v) => !v);
    if (!this.cwOpen()) {
      this.spoilerText.set('');
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      this.uploading.set(true);
      this.api.uploadMedia(file).subscribe({
        next: (media) => {
          this.media.update((list) => [...list, { media, description: '' }]);
          this.uploading.set(false);
        },
        error: () => this.uploading.set(false),
      });
    }
  }

  setMediaDescription(index: number, description: string): void {
    this.media.update((list) =>
      list.map((m, i) => (i === index ? { ...m, description } : m)),
    );
  }

  removeMedia(index: number): void {
    this.media.update((list) => list.filter((_, i) => i !== index));
  }

  togglePoll(): void {
    this.pollOpen.update((v) => !v);
    if (!this.pollOpen()) {
      this.pollOptions.set(['', '']);
      this.pollMultiple.set(false);
    }
  }

  setPollOption(index: number, value: string): void {
    this.pollOptions.update((opts) => opts.map((o, i) => (i === index ? value : o)));
  }

  addPollOption(): void {
    if (this.pollOptions().length < 4) {
      this.pollOptions.update((opts) => [...opts, '']);
    }
  }

  removePollOption(index: number): void {
    if (this.pollOptions().length > 2) {
      this.pollOptions.update((opts) => opts.filter((_, i) => i !== index));
    }
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.submitting.set(true);

    const options: ComposeOptions = {
      inReplyToId: this.inReplyToId(),
      quotedStatusId: this.quotedStatusId(),
      visibility: this.visibility(),
    };
    if (this.cwOpen() && this.spoilerText().trim()) {
      options.spoilerText = this.spoilerText().trim();
    }
    if (this.sensitive()) {
      options.sensitive = true;
    }
    if (this.media().length) {
      options.mediaIds = this.media().map((m) => m.media.id);
    }
    if (this.pollOpen()) {
      const pollOpts = this.pollOptions().map((o) => o.trim()).filter(Boolean);
      if (pollOpts.length >= 2) {
        options.poll = {
          options: pollOpts,
          expiresIn: this.pollExpiresIn(),
          multiple: this.pollMultiple(),
        };
      }
    }

    // Persist any alt-text the user typed before sending the status.
    for (const m of this.media()) {
      if (m.description.trim()) {
        this.api.updateMedia(m.media.id, m.description.trim()).subscribe();
      }
    }

    this.api.postStatus(this.text().trim(), options).subscribe({
      next: (status) => {
        this.reset();
        this.posted.emit(status);
      },
      error: () => this.submitting.set(false),
    });
  }

  private reset(): void {
    this.text.set('');
    this.submitting.set(false);
    this.cwOpen.set(false);
    this.spoilerText.set('');
    this.sensitive.set(false);
    this.media.set([]);
    this.pollOpen.set(false);
    this.pollOptions.set(['', '']);
    this.pollMultiple.set(false);
  }
}
