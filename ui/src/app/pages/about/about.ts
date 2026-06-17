import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { CustomEmoji, InstanceRule, TermsOfService } from '../../models';

/** "About this server": instance rules, terms of service, and custom emojis. */
@Component({
  selector: 'app-about',
  imports: [],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About implements OnInit {
  private api = inject(Api);

  protected rules = signal<InstanceRule[]>([]);
  protected tos = signal<TermsOfService | null>(null);
  protected emojis = signal<CustomEmoji[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.instanceRules().subscribe((r) => this.rules.set(r));
    // The ToS endpoint 404s when none is configured — treat any error as "none".
    this.api.termsOfService().subscribe({
      next: (t) => this.tos.set(t),
      error: () => this.tos.set(null),
    });
    this.api.customEmojis().subscribe({
      next: (e) => {
        this.emojis.set(e);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
