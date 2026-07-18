import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { ClientPrefs } from '../../client-prefs';
import { MastodonNotification, Relationship, Status } from '../../models';
import { Streaming } from '../../streaming';
import { Compose } from '../../compose/compose';
import { AccountListDialog, AccountListMode } from '../../account-list-dialog/account-list-dialog';

type NotifAudience = 'all' | 'friends' | 'followers';

/** Collapse buckets only once they outgrow this many distinct people. */
export const GROUP_THRESHOLD = 3;

export type NotifRow =
  | { kind: 'single'; key: string; notif: MastodonNotification }
  | {
      kind: 'group';
      key: string;
      type: string;
      status: Status;
      /** First few distinct accounts, for the stacked avatars / name line. */
      sample: MastodonNotification[];
      /** Distinct accounts in the bucket (one person twice counts once). */
      count: number;
    };

/**
 * Group notifications that point at the same status (100 boosts of one post
 * read as one row, not 100). Mentions stay individual — each reply is its own
 * conversation — as do types without a status (follow, admin reports…).
 * Buckets at or under the threshold stay expanded in place; a collapsed group
 * takes its newest member's position, so the list stays newest-first.
 */
export function groupNotifications(
  list: MastodonNotification[],
  threshold = GROUP_THRESHOLD,
): NotifRow[] {
  const buckets = new Map<string, MastodonNotification[]>();
  for (const n of list) {
    if (n.type === 'mention' || !n.status) {
      continue;
    }
    const key = `${n.type}:${n.status.id}`;
    buckets.set(key, [...(buckets.get(key) ?? []), n]);
  }

  const rows: NotifRow[] = [];
  const emitted = new Set<string>();
  for (const n of list) {
    const key = n.type === 'mention' || !n.status ? null : `${n.type}:${n.status.id}`;
    const bucket = key ? buckets.get(key)! : null;
    if (!key || !bucket) {
      rows.push({ kind: 'single', key: `n:${n.id}`, notif: n });
      continue;
    }
    const distinct = dedupeByAccount(bucket);
    if (distinct.length <= threshold) {
      rows.push({ kind: 'single', key: `n:${n.id}`, notif: n });
      continue;
    }
    if (emitted.has(key)) {
      continue; // already collapsed at the newest member's position
    }
    emitted.add(key);
    rows.push({
      kind: 'group',
      key: `g:${key}`,
      type: n.type,
      status: n.status!,
      sample: distinct.slice(0, 3),
      count: distinct.length,
    });
  }
  return rows;
}

function dedupeByAccount(bucket: MastodonNotification[]): MastodonNotification[] {
  const seen = new Set<string>();
  const out: MastodonNotification[] = [];
  for (const n of bucket) {
    if (!seen.has(n.account.id)) {
      seen.add(n.account.id);
      out.push(n);
    }
  }
  return out;
}

@Component({
  selector: 'app-notifications',
  imports: [RouterLink, Compose, FormsModule, AccountListDialog],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class Notifications implements OnInit, OnDestroy {
  private api = inject(Api);
  private streaming = inject(Streaming);
  private prefs = inject(ClientPrefs);

  /** Media thumbnails respect the feed-wide images on/off preference. */
  protected showImages = this.prefs.showImages;

  protected items = signal<MastodonNotification[]>([]);
  protected loading = signal(true);
  protected live = signal(false);

  // List filters: who the notification is from, and what kind it is.
  protected audience = signal<NotifAudience>('all');
  protected typeFilter = signal<string>('all');

  /** Relationships for the friends/followers filters; fetched lazily. */
  private rels = signal<Map<string, Relationship>>(new Map());
  private requestedRels = new Set<string>();

  /** Distinct notification types present, for the type dropdown. */
  protected types = computed(() => [...new Set(this.items().map((n) => n.type))].sort());

  protected visible = computed(() => {
    const type = this.typeFilter();
    const audience = this.audience();
    const rels = this.rels();
    return this.items().filter((n) => {
      if (type !== 'all' && n.type !== type) {
        return false;
      }
      if (audience === 'all') {
        return true;
      }
      const r = rels.get(n.account.id);
      return audience === 'friends' ? !!r?.following : !!r?.followed_by;
    });
  });

  /** The filtered list with same-status pile-ups collapsed into group rows. */
  protected rows = computed(() => groupNotifications(this.visible()));

  /** The "who favourited / who boosted" dialog opened from a group row. */
  protected listTarget = signal<{ statusId: string; mode: AccountListMode } | null>(null);

  constructor() {
    effect(() => {
      if (this.audience() === 'all') {
        return;
      }
      const missing = [
        ...new Set(
          this.items()
            .map((n) => n.account.id)
            .filter((id) => !this.requestedRels.has(id)),
        ),
      ];
      if (!missing.length) {
        return;
      }
      for (const id of missing) {
        this.requestedRels.add(id);
      }
      this.api.relationships(missing).subscribe((list) => {
        this.rels.update((map) => {
          const next = new Map(map);
          for (const r of list) {
            next.set(r.id, r);
          }
          return next;
        });
      });
    });
  }

  private liveSub: Subscription | null = null;

  ngOnInit(): void {
    this.api.notifications().subscribe({
      next: (n) => {
        this.items.set(n);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
  }

  toggleLive(): void {
    if (this.live()) {
      this.liveSub?.unsubscribe();
      this.liveSub = null;
      this.live.set(false);
      return;
    }
    this.live.set(true);
    this.liveSub = this.streaming.open({ stream: 'user' }).subscribe(({ event, payload }) => {
      if (event === 'notification') {
        this.items.update((list) => [payload as MastodonNotification, ...list]);
      }
    });
  }

  /** Dialog mode for a grouped type; null when the API has no "who did it" list. */
  listMode(type: string): AccountListMode | null {
    return type === 'favourite' ? 'favourited_by' : type === 'reblog' ? 'reblogged_by' : null;
  }

  othersLabel(row: NotifRow & { kind: 'group' }): string {
    const rest = row.count - row.sample.length;
    return `and ${rest} ${rest === 1 ? 'other' : 'others'}`;
  }

  openGroupList(row: NotifRow & { kind: 'group' }): void {
    const mode = this.listMode(row.type);
    if (mode) {
      this.listTarget.set({ statusId: row.status.id, mode });
    }
  }

  label(type: string): string {
    switch (type) {
      case 'favourite':
        return 'favourited your status';
      case 'reblog':
        return 'boosted your status';
      case 'follow':
        return 'followed you';
      case 'mention':
        return 'mentioned you';
      default:
        return type;
    }
  }
}
