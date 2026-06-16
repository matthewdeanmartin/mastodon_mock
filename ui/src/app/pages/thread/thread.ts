import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../api';
import { Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-thread',
  imports: [StatusCard, Compose],
  templateUrl: './thread.html',
})
export class Thread implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  protected status = signal<Status | null>(null);
  protected ancestors = signal<Status[]>([]);
  protected descendants = signal<Status[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.api.getStatus(id).subscribe((s) => {
      this.status.set(s);
      this.loading.set(false);
    });
    this.api.getContext(id).subscribe((ctx) => {
      this.ancestors.set(ctx.ancestors);
      this.descendants.set(ctx.descendants);
    });
  }

  onReply(status: Status): void {
    this.descendants.update((d) => [...d, status]);
  }
}
