import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { InstanceRule, TermsOfService } from '../../models';

/** "About this server": instance rules and terms of service. */
@Component({
  selector: 'app-about',
  imports: [RouterLink],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About implements OnInit {
  private api = inject(Api);

  protected rules = signal<InstanceRule[]>([]);
  protected tos = signal<TermsOfService | null>(null);

  ngOnInit(): void {
    this.api.instanceRules().subscribe((r) => this.rules.set(r));
    // The ToS endpoint 404s when none is configured — treat any error as "none".
    this.api.termsOfService().subscribe({
      next: (t) => this.tos.set(t),
      error: () => this.tos.set(null),
    });
  }
}
