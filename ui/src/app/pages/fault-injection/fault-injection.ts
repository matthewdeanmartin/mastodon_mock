import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MockApi } from '../../mock-api';
import { FaultEffectType, FaultRule, FaultRuleDraft } from '../../models';

@Component({
  selector: 'app-fault-injection',
  imports: [FormsModule],
  templateUrl: './fault-injection.html',
  styleUrl: './fault-injection.css',
})
export class FaultInjection implements OnInit {
  private api = inject(MockApi);

  protected rules = signal<FaultRule[]>([]);
  protected loading = signal(true);
  protected error = signal<string | null>(null);

  // New-rule form state.
  protected method = signal('');
  protected path = signal('');
  protected pathRegex = signal('');
  protected effectType = signal<FaultEffectType>('status');
  protected status = signal(503);
  protected delayMs = signal(0);
  protected count = signal<number | null>(null);
  protected adding = signal(false);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.listFaults().subscribe({
      next: (rules) => {
        this.rules.set(rules);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  addRule(): void {
    this.error.set(null);
    const draft: FaultRuleDraft = {
      match: {
        ...(this.method().trim() ? { methods: [this.method().trim().toUpperCase()] } : {}),
        ...(this.path().trim() ? { path: this.path().trim() } : {}),
        ...(this.pathRegex().trim() ? { path_regex: this.pathRegex().trim() } : {}),
      },
      effect: {
        type: this.effectType(),
        status: this.status(),
        delay_ms: this.delayMs(),
      },
      ...(this.count() ? { count: this.count()! } : {}),
    };
    this.adding.set(true);
    this.api.addFault(draft).subscribe({
      next: (rule) => {
        this.adding.set(false);
        this.rules.update((list) => [...list, rule]);
      },
      error: (err) => {
        this.adding.set(false);
        this.error.set(err?.error?.detail ?? 'Could not add rule.');
      },
    });
  }

  remove(id: string): void {
    this.api.deleteFault(id).subscribe(() => {
      this.rules.update((list) => list.filter((r) => r.id !== id));
    });
  }

  clearAll(): void {
    this.api.clearFaults().subscribe(() => this.rules.set([]));
  }

  needsStatus(): boolean {
    return this.effectType() === 'status' || this.effectType() === 'ratelimit';
  }

  needsDelay(): boolean {
    return this.effectType() === 'latency' || this.effectType() === 'timeout';
  }
}
