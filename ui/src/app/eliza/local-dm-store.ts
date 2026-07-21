/**
 * The viewer's private chat with Eliza — a browser-local DM thread.
 *
 * Anonymous visitors can't call the real chat API at all, and signed-in users
 * shouldn't DM a fake account through their real one, so the whole thread lives
 * here in localStorage, scoped per account via {@link scopedKey}. The thread
 * only exists once the viewer follows Eliza (see {@link ElizaFollow}); on the
 * first follow it is seeded with one inbound message from her.
 *
 * Sending Eliza a message appends the viewer's line and her immediate ELIZA
 * reply. Messages are plain {@link ElizaDmMessage} records (not Mastodon
 * Statuses) — the chat view renders them directly.
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import { scopedKey } from '../account-scope';
import { ElizaService } from './eliza.service';
import { LocalNotificationStore } from './local-notification-store';
import { ELIZA_FIRST_DM } from './eliza-content';

const BASE_KEY = 'mockingbird_eliza_dm';
const STATE_VERSION = 1;

/** One line in the Eliza DM thread. */
export interface ElizaDmMessage {
  id: string;
  /** Who wrote it: the viewer, or Eliza. */
  from: 'me' | 'eliza';
  text: string;
  createdAt: string;
}

interface DmState {
  version: typeof STATE_VERSION;
  messages: ElizaDmMessage[];
  /** True once the seed message has been planted, so it happens exactly once. */
  seeded: boolean;
}

function storageKey(): string {
  return scopedKey(BASE_KEY);
}

function loadState(): DmState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) ?? 'null') as Partial<DmState> | null;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.messages)) {
      return { version: STATE_VERSION, messages: [], seeded: false };
    }
    return {
      version: STATE_VERSION,
      seeded: !!parsed.seeded,
      messages: parsed.messages.filter(
        (m): m is ElizaDmMessage => typeof m?.id === 'string' && typeof m.text === 'string',
      ),
    };
  } catch {
    return { version: STATE_VERSION, messages: [], seeded: false };
  }
}

let counter = 0;
function freshId(): string {
  counter += 1;
  return `dm:${Date.now()}-${counter}`;
}

@Injectable({ providedIn: 'root' })
export class LocalDmStore {
  private readonly eliza = inject(ElizaService);
  private readonly notifications = inject(LocalNotificationStore);

  private readonly state = signal<DmState>(loadState());

  /** The thread, oldest-first (chat reading order). */
  readonly messages = computed(() => this.state().messages);

  /** Re-read from storage after an account switch changes the scope. */
  refresh(): void {
    this.state.set(loadState());
  }

  /** Plant the opening "How do you feel about that?" DM if it hasn't been sent
   *  yet. Idempotent — safe to call every time the chat opens. */
  ensureSeeded(): void {
    if (this.state().seeded) {
      return;
    }
    this.state.update((s) => {
      const seed: ElizaDmMessage = {
        id: freshId(),
        from: 'eliza',
        text: ELIZA_FIRST_DM,
        createdAt: new Date().toISOString(),
      };
      const next: DmState = { ...s, seeded: true, messages: [...s.messages, seed] };
      this.persist(next);
      return next;
    });
  }

  /** Send a message to Eliza; she replies immediately. Returns nothing — the
   *  `messages` signal updates for the view. Blank input is ignored. */
  send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const now = Date.now();
    const mine: ElizaDmMessage = {
      id: freshId(),
      from: 'me',
      text: trimmed,
      createdAt: new Date(now).toISOString(),
    };
    const reply: ElizaDmMessage = {
      id: freshId(),
      from: 'eliza',
      text: this.eliza.reply(trimmed),
      createdAt: new Date(now + 500).toISOString(),
    };
    this.state.update((s) => {
      const next: DmState = { ...s, messages: [...s.messages, mine, reply] };
      this.persist(next);
      return next;
    });
    this.notifications.push('message', reply.text, '/eliza/chat');
  }

  /** Wipe the thread (used when the viewer unfollows Eliza). */
  clear(): void {
    const next: DmState = { version: STATE_VERSION, messages: [], seeded: false };
    this.persist(next);
    this.state.set(next);
  }

  private persist(state: DmState): void {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch {
      // Storage unavailable: keep the in-memory copy so the session still works.
    }
  }
}
