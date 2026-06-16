import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApi } from '../admin-api';
import { DomainBlock } from '../../models';

@Component({
  selector: 'app-admin-domains',
  imports: [FormsModule],
  templateUrl: './admin-domains.html',
  styleUrl: './admin-domains.css',
})
export class AdminDomains implements OnInit {
  private api = inject(AdminApi);

  protected blocks = signal<DomainBlock[]>([]);
  protected loading = signal(true);

  protected newDomain = signal('');
  protected severity = signal('silence');
  protected submitting = signal(false);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.domainBlocks().subscribe({
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
    this.api.createDomainBlock(domain, this.severity()).subscribe({
      next: (block) => {
        this.blocks.update((b) => [block, ...b.filter((x) => x.id !== block.id)]);
        this.newDomain.set('');
        this.submitting.set(false);
      },
      error: () => this.submitting.set(false),
    });
  }

  remove(block: DomainBlock): void {
    this.api.deleteDomainBlock(block.id).subscribe(() => {
      this.blocks.update((b) => b.filter((x) => x.id !== block.id));
    });
  }
}
