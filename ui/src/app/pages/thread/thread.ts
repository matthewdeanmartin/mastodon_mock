import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../api';
import { ClientPrefs } from '../../client-prefs';
import { Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { HumanTimePipe } from '../../human-time.pipe';
import { readerChain } from './reader-chain';

@Component({
  selector: 'app-thread',
  imports: [StatusCard, Compose, HumanTimePipe],
  templateUrl: './thread.html',
  styleUrl: './thread.css',
})
export class Thread implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected readonly prefs = inject(ClientPrefs);

  protected status = signal<Status | null>(null);
  protected ancestors = signal<Status[]>([]);
  protected descendants = signal<Status[]>([]);
  protected loading = signal(true);

  /** Reader mode: distraction-free article view of the author's own chain. */
  protected readerMode = signal(false);

  /** The whole thread in display order. */
  private thread = computed<Status[]>(() => {
    const s = this.status();
    return s ? [...this.ancestors(), s, ...this.descendants()] : [];
  });

  /** The author chain reader mode renders (root post + same-author self-replies). */
  protected chain = computed<Status[]>(() => readerChain(this.thread()));

  /** Reader mode is only worth offering for actual threads. */
  protected readerAvailable = computed(() => this.chain().length > 1);

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

  toggleReader(): void {
    this.readerMode.update((v) => !v);
  }

  bumpReaderFont(delta: number): void {
    this.prefs.setReaderFontSize(this.prefs.readerFontSize() + delta);
  }

  onReply(status: Status): void {
    this.descendants.update((d) => [...d, status]);
  }

  onChanged(updated: Status): void {
    this.status.set(updated);
  }

  onContextChanged(updated: Status): void {
    const patch = (list: Status[]) => list.map((s) => (s.id === updated.id ? updated : s));
    this.ancestors.update(patch);
    this.descendants.update(patch);
  }

  onContextDeleted(removed: Status): void {
    const drop = (list: Status[]) => list.filter((s) => s.id !== removed.id);
    this.ancestors.update(drop);
    this.descendants.update(drop);
  }

  /** The focused status was deleted: leave the thread. */
  onFocusedDeleted(): void {
    this.router.navigateByUrl('/home');
  }
}
