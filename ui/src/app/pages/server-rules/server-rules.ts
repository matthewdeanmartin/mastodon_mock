import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { InstanceRule } from '../../models';

/** Rules published by the connected Mastodon instance. */
@Component({
  selector: 'app-server-rules',
  templateUrl: './server-rules.html',
  styleUrl: './server-rules.css',
})
export class ServerRules implements OnInit {
  private api = inject(Api);

  protected rules = signal<InstanceRule[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.instanceRules().subscribe({
      next: (rules) => {
        this.rules.set(rules);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
