import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApi } from '../admin-api';
import { EmailDomainBlock } from '../../models';

@Component({
  selector: 'app-admin-email-blocks',
  imports: [FormsModule],
  templateUrl: './admin-email-blocks.html',
  styleUrl: './admin-lists.css',
})
export class AdminEmailBlocks implements OnInit {
  private api = inject(AdminApi);

  protected blocks = signal<EmailDomainBlock[]>([]);
  protected loading = signal(true);
  protected newDomain = signal('');
  protected submitting = signal(false);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.emailDomainBlocks().subscribe({
      next: (b) => {
        this.blocks.set(b);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  add(): void {
    const domain = this.newDomain().trim();
    if (!domain || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.api.createEmailDomainBlock(domain).subscribe({
      next: (block) => {
        this.blocks.update((b) => [block, ...b]);
        this.newDomain.set('');
        this.submitting.set(false);
      },
      error: () => this.submitting.set(false),
    });
  }

  remove(block: EmailDomainBlock): void {
    this.api.deleteEmailDomainBlock(block.id).subscribe(() => {
      this.blocks.update((b) => b.filter((x) => x.id !== block.id));
    });
  }
}
