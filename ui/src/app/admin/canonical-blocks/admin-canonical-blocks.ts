import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApi } from '../admin-api';
import { CanonicalEmailBlock } from '../../models';

@Component({
  selector: 'app-admin-canonical-blocks',
  imports: [FormsModule],
  templateUrl: './admin-canonical-blocks.html',
  styleUrl: './admin-lists.css',
})
export class AdminCanonicalBlocks implements OnInit {
  private api = inject(AdminApi);

  protected blocks = signal<CanonicalEmailBlock[]>([]);
  protected loading = signal(true);
  protected newEmail = signal('');
  protected submitting = signal(false);

  // Canonicalization test.
  protected testEmail = signal('');
  protected testResult = signal<CanonicalEmailBlock[] | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.canonicalEmailBlocks().subscribe({
      next: (b) => {
        this.blocks.set(b);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  add(): void {
    const email = this.newEmail().trim();
    if (!email || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.api.createCanonicalEmailBlock(email).subscribe({
      next: (block) => {
        this.blocks.update((b) => [block, ...b]);
        this.newEmail.set('');
        this.submitting.set(false);
      },
      error: () => this.submitting.set(false),
    });
  }

  test(): void {
    const email = this.testEmail().trim();
    if (!email) {
      return;
    }
    this.api.testCanonicalEmailBlock(email).subscribe((matches) => this.testResult.set(matches));
  }

  remove(block: CanonicalEmailBlock): void {
    this.api.deleteCanonicalEmailBlock(block.id).subscribe(() => {
      this.blocks.update((b) => b.filter((x) => x.id !== block.id));
    });
  }
}
