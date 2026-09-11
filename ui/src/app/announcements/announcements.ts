import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../api';
import { Announcement } from '../models';

// A few quick-pick reactions; the API accepts any unicode emoji shortcode/char.
const QUICK_REACTIONS = ['👍', '🎉', '❤️', '🚀'];

/** Active instance announcements shown above a timeline (dismiss + react). */
@Component({
  selector: 'app-announcements',
  imports: [],
  templateUrl: './announcements.html',
  styleUrl: './announcements.css',
})
export class Announcements implements OnInit {
  private api = inject(Api);

  protected readonly quickReactions = QUICK_REACTIONS;
  protected announcements = signal<Announcement[]>([]);

  ngOnInit(): void {
    this.api.announcements().subscribe((a) => this.announcements.set(a));
  }

  dismiss(a: Announcement): void {
    // Optimistically drop it; dismiss is idempotent server-side.
    this.announcements.update((list) => list.filter((x) => x.id !== a.id));
    this.api.dismissAnnouncement(a.id).subscribe();
  }

  toggleReaction(a: Announcement, name: string): void {
    const existing = a.reactions.find((r) => r.name === name);
    const mine = existing?.me ?? false;
    const call = mine
      ? this.api.removeAnnouncementReaction(a.id, name)
      : this.api.addAnnouncementReaction(a.id, name);
    call.subscribe(() => this.applyReaction(a, name, !mine));
  }

  /** Patch the local reaction list after a successful toggle (no refetch). */
  private applyReaction(a: Announcement, name: string, me: boolean): void {
    this.announcements.update((list) =>
      list.map((x) => {
        if (x.id !== a.id) {
          return x;
        }
        const reactions = [...x.reactions];
        const idx = reactions.findIndex((r) => r.name === name);
        if (idx === -1) {
          reactions.push({ name, count: 1, me: true, url: null, static_url: null });
        } else {
          const count = reactions[idx].count + (me ? 1 : -1);
          if (count <= 0) {
            reactions.splice(idx, 1);
          } else {
            reactions[idx] = { ...reactions[idx], count, me };
          }
        }
        return { ...x, reactions };
      }),
    );
  }
}
