import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../api';
import { Announcement } from '../models';

// A few quick-pick reactions; the API accepts any unicode emoji shortcode/char.
const QUICK_REACTIONS = ['👍', '🎉', '❤️', '🚀'];

/**
 * localStorage key holding the ids the viewer has dismissed. The server-side
 * dismiss endpoint isn't reachable on every instance (and doesn't hide the
 * banner on refresh for the current session anyway), so we keep a client-side
 * "seen it" list — the banner must be dismissable against mastodon.social.
 */
const DISMISSED_KEY = 'mockingbird_dismissed_announcements';

function readDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

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

  /** Ids the viewer has already dismissed (client-side "seen it" list). */
  private dismissed = new Set<string>(readDismissed());

  ngOnInit(): void {
    this.api.announcements().subscribe((a) =>
      // Filter out anything already dismissed on this device, then keep it hidden.
      this.announcements.set(a.filter((x) => !this.dismissed.has(x.id))),
    );
  }

  dismiss(a: Announcement): void {
    // Optimistically drop it and remember the choice locally so it stays gone
    // on refresh even when the server dismiss endpoint isn't available.
    this.announcements.update((list) => list.filter((x) => x.id !== a.id));
    this.dismissed.add(a.id);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...this.dismissed]));
    // Best-effort server dismiss; a failure is fine, the local flag holds.
    this.api.dismissAnnouncement(a.id).subscribe({ error: () => undefined });
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
