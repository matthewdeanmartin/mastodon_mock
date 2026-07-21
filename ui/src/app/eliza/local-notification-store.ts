/**
 * Eliza's notifications — a browser-local inbox, per account.
 *
 * Anonymous visitors can't reach the real notifications API (it's blocked, like
 * chat), so Eliza's activity toward the viewer is recorded here instead:
 *   - she replies to a local practice post  → a 'reply' notification
 *   - she sends a DM in the chat thread      → a 'message' notification
 *   - the viewer follows her                 → a one-time 'welcome' notification
 *
 * The Eliza inbox page reads {@link items} and {@link unread}; opening it marks
 * everything read via {@link markAllRead}. State is scoped per account via
 * {@link scopedKey}, matching the other Eliza stores.
 */

import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../account-scope';

const BASE_KEY = 'mockingbird_eliza_notifications';
const STATE_VERSION = 1;
/** Keep the inbox from growing without bound. */
const MAX_ITEMS = 100;

export type ElizaNotifKind = 'reply' | 'message' | 'welcome';

/** One entry in Eliza's local inbox. */
export interface ElizaNotification {
  id: string;
  kind: ElizaNotifKind;
  /** Preview text (the reply/DM body, or the welcome line). */
  text: string;
  /** Deep-link target when the notification is clicked. */
  link: string;
  createdAt: string;
  read: boolean;
}

interface NotifState {
  version: typeof STATE_VERSION;
  items: ElizaNotification[];
}

function storageKey(): string {
  return scopedKey(BASE_KEY);
}

function loadState(): NotifState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey()) ?? 'null',
    ) as Partial<NotifState> | null;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.items)) {
      return { version: STATE_VERSION, items: [] };
    }
    return {
      version: STATE_VERSION,
      items: parsed.items.filter(
        (n): n is ElizaNotification => typeof n?.id === 'string' && typeof n.text === 'string',
      ),
    };
  } catch {
    return { version: STATE_VERSION, items: [] };
  }
}

let counter = 0;
function freshId(): string {
  counter += 1;
  return `en:${Date.now()}-${counter}`;
}

@Injectable({ providedIn: 'root' })
export class LocalNotificationStore {
  private readonly state = signal<NotifState>(loadState());

  /** All notifications, newest first. */
  readonly items = computed(() =>
    [...this.state().items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  );

  /** How many are unread — for the nav badge. */
  readonly unread = computed(() => this.state().items.filter((n) => !n.read).length);

  /** Re-read from storage after an account switch changes the scope. */
  refresh(): void {
    this.state.set(loadState());
  }

  /** Record a new notification from Eliza. */
  push(kind: ElizaNotifKind, text: string, link: string): void {
    const notif: ElizaNotification = {
      id: freshId(),
      kind,
      text,
      link,
      createdAt: new Date().toISOString(),
      read: false,
    };
    this.state.update((s) => {
      const items = [notif, ...s.items].slice(0, MAX_ITEMS);
      const next = { ...s, items };
      this.persist(next);
      return next;
    });
  }

  /** Add the one-time welcome notification, unless one already exists. */
  ensureWelcome(): void {
    if (this.state().items.some((n) => n.kind === 'welcome')) {
      return;
    }
    this.push('welcome', 'Eliza started a conversation with you. Say hi!', '/eliza/chat');
  }

  /** Mark everything read (called when the inbox is opened). */
  markAllRead(): void {
    if (!this.unread()) {
      return;
    }
    this.state.update((s) => {
      const next = { ...s, items: s.items.map((n) => ({ ...n, read: true })) };
      this.persist(next);
      return next;
    });
  }

  /** Wipe the inbox. */
  clear(): void {
    const next: NotifState = { version: STATE_VERSION, items: [] };
    this.persist(next);
    this.state.set(next);
  }

  private persist(state: NotifState): void {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch {
      // Storage unavailable: keep the in-memory copy so the session still works.
    }
  }
}
