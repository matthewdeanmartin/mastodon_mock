import { Injectable, signal } from '@angular/core';

/** Poll state carried in a draft (mirrors the composer's poll builder). */
export interface DraftPoll {
  options: string[];
  multiple: boolean;
  expiresIn: number;
}

/**
 * A saved composer state. Media attachments are deliberately absent: uploads
 * only exist server-side as transient ids, so they can't survive in a draft.
 */
export interface Draft {
  id: string;
  updatedAt: string;
  /** Thread segments; index 0 is the primary post. */
  segments: string[];
  spoilerText: string;
  sensitive: boolean;
  visibility: string;
  poll: DraftPoll | null;
  inReplyToId?: string;
  quotedStatusId?: string;
  /** Publishing destination. Missing on drafts saved before provider-aware compose. */
  target?: 'fedi' | 'bsky' | 'both' | 'paste';
  /** Paste-service id, deliberately separate so another pastebin can be added later. */
  pasteProviderId?: string;
  pasteLanguage?: string;
  pasteExpiry?: string;
}

export type DraftSnapshot = Omit<Draft, 'id' | 'updatedAt'>;

const DRAFTS_KEY = 'mockingbird_drafts';
const AUTOSAVE_KEY = 'mockingbird_compose_autosave';

/** True when a snapshot has anything worth keeping. */
export function draftHasContent(d: DraftSnapshot): boolean {
  return d.segments.some((s) => s.trim() !== '') || d.spoilerText.trim() !== '' || !!d.poll;
}

/**
 * Drafts live in localStorage only — mainline Mastodon has no drafts API, and
 * Mockingbird must work unchanged against mastodon.social.
 *
 * Two stores: a named drafts list (explicit "Save draft", shown on /drafts),
 * and a per-context autosave slot so a stray reload never eats a half-written
 * post. Context keys are 'new', 'reply:<id>' or 'quote:<id>'.
 */
@Injectable({ providedIn: 'root' })
export class Drafts {
  readonly drafts = signal<Draft[]>(loadJson<Draft[]>(DRAFTS_KEY) ?? []);

  get(id: string): Draft | undefined {
    return this.drafts().find((d) => d.id === id);
  }

  /** Add a snapshot to the drafts list (newest first) and return its id. */
  save(snapshot: DraftSnapshot): string {
    const draft: Draft = {
      ...snapshot,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      updatedAt: new Date().toISOString(),
    };
    this.drafts.update((list) => [draft, ...list]);
    this.persist();
    return draft.id;
  }

  remove(id: string): void {
    this.drafts.update((list) => list.filter((d) => d.id !== id));
    this.persist();
  }

  // --- autosave slots ---

  autosave(contextKey: string, snapshot: DraftSnapshot): void {
    const slots = loadJson<Record<string, DraftSnapshot>>(AUTOSAVE_KEY) ?? {};
    if (draftHasContent(snapshot)) {
      slots[contextKey] = snapshot;
    } else {
      delete slots[contextKey];
    }
    storeJson(AUTOSAVE_KEY, slots);
  }

  loadAutosave(contextKey: string): DraftSnapshot | null {
    const slots = loadJson<Record<string, DraftSnapshot>>(AUTOSAVE_KEY) ?? {};
    return slots[contextKey] ?? null;
  }

  clearAutosave(contextKey: string): void {
    const slots = loadJson<Record<string, DraftSnapshot>>(AUTOSAVE_KEY) ?? {};
    if (contextKey in slots) {
      delete slots[contextKey];
      storeJson(AUTOSAVE_KEY, slots);
    }
  }

  private persist(): void {
    storeJson(DRAFTS_KEY, this.drafts());
  }
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function storeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — drafts degrade to session-only.
  }
}
