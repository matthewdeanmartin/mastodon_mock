import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../api';
import { Status } from '../models';

@Component({
  selector: 'app-compose',
  imports: [FormsModule],
  templateUrl: './compose.html',
  styleUrl: './compose.css',
})
export class Compose {
  private api = inject(Api);

  readonly inReplyToId = input<string | undefined>(undefined);
  readonly placeholder = input('What is happening?');
  readonly posted = output<Status>();

  protected text = signal('');
  protected submitting = signal(false);

  submit(): void {
    const body = this.text().trim();
    if (!body || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.api.postStatus(body, this.inReplyToId()).subscribe({
      next: (status) => {
        this.text.set('');
        this.submitting.set(false);
        this.posted.emit(status);
      },
      error: () => this.submitting.set(false),
    });
  }
}
