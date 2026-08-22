import { computed, Injectable, signal } from '@angular/core';

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
  /**
   * Publishing destination. Missing on drafts saved before provider-aware compose.
   *
   * Spelled out rather than importing `PostTarget`: compose imports *this*
   * module, so pointing back at it would make a cycle. Keep the two in step —
   * a target missing here is a compile error at the save site, which is the
   * right place to find out. A target that is no longer valid does not need
   * removing here, since restoring one is already filtered through
   * `Compose.restorableTarget`.
   */
  target?: 'fedi' | 'bsky' | 'both' | 'paste' | 'blog' | 'blogger' | 'hugo';
  /** Paste-service id, deliberately separate so another pastebin can be added later. */
  pasteProviderId?: string;
  pasteLanguage?: string;
  pasteExpiry?: string;
}

export type DraftSnapshot = Omit<Draft, 'id' | 'updatedAt'>;

/** A post handed from /drafts to the composer by "Edit for post". */
export interface DraftHandoff {
  snapshot: DraftSnapshot;
  /**
   * Set when this came from a post-to-self draft. Publishing it for real leaves
   * a duplicate private copy sitting in the DM tab, so the composer offers to
   * delete that copy — but only *after* the publish succeeds. See the composer's
   * `pendingSelfCleanup`.
   */
  selfStatusId?: string;
}

const DRAFTS_KEY = 'mockingbird_drafts';
const AUTOSAVE_KEY = 'mockingbird_compose_autosave';

/** True when a snapshot has anything worth keeping. */
export function draftHasContent(d: DraftSnapshot): boolean {
  return d.segments.some((s) => s.trim() !== '') || d.spoilerText.trim() !== '' || !!d.poll;
}

/**
 * A blank draft, ready to be typed into.
 *
 * Exists so "start writing" has one definition of empty rather than one per
 * caller: a snapshot built field-by-field at each call site drifts the moment
 * {@link Draft} grows a field, and the drift shows up as a draft that silently
 * loses a setting. Visibility is a parameter because the only sensible default
 * is the user's, which this module has no business reaching for.
 */
export function emptyDraftSnapshot(visibility: string): DraftSnapshot {
  return {
    segments: [''],
    spoilerText: '',
    sensitive: false,
    visibility,
    poll: null,
  };
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

  /**
   * Overwrite an existing draft in place, keeping its id and list position.
   *
   * Without this, editing a saved draft and saving it again meant `save()` — a
   * second row with the same text, and no way to tell which one is current. The
   * writing workspace edits one draft over a long session, so "save" there has
   * to mean *this* draft rather than another copy of it.
   *
   * Position is preserved rather than bumping the draft to the top: in a list
   * you are working *through*, having the row you just touched jump out from
   * under the cursor is worse than having it stay put. `updatedAt` still
   * advances, so anything that sorts by time can order it however it likes.
   *
   * Returns false when the id is gone — deleted in another tab, or from
   * `/drafts` while the workspace held it — so the caller can save a fresh copy
   * rather than silently discarding the user's edit.
   */
  update(id: string, snapshot: DraftSnapshot): boolean {
    if (!this.drafts().some((d) => d.id === id)) {
      return false;
    }
    this.drafts.update((list) =>
      list.map((d) => (d.id === id ? { ...snapshot, id, updatedAt: new Date().toISOString() } : d)),
    );
    this.persist();
    return true;
  }

  remove(id: string): void {
    this.drafts.update((list) => list.filter((d) => d.id !== id));
    this.persist();
  }

  // --- composer handoff ---

  /**
   * A snapshot waiting to be picked up by the next composer that opens.
   *
   * "Edit for post" has to move a whole post — segments, spoiler, poll, paste
   * metadata — from /drafts across a route change into the composer. Putting
   * that in the URL is out (a 500-character post is not a query param), and
   * saving it as a real draft is out too, because the whole point is that the
   * source is left alone rather than converted. So it rides in memory for the
   * one navigation, and the composer drains it on seed.
   *
   * Deliberately not persisted: a snapshot that outlived a reload would
   * reappear in an unrelated composer later, which is worse than losing a
   * navigation that failed anyway.
   */
  private readonly handoffSlot = signal<DraftHandoff | null>(null);

  /** Whether a snapshot is waiting, without consuming it. */
  readonly hasHandoff = computed(() => this.handoffSlot() !== null);

  /** Park a snapshot for the next composer to open. */
  handoff(snapshot: DraftSnapshot, selfStatusId?: string): void {
    this.handoffSlot.set({ snapshot, selfStatusId });
  }

  /** Take the parked handoff, if any, clearing it so it seeds exactly once. */
  takeHandoff(): DraftHandoff | null {
    const handoff = this.handoffSlot();
    if (handoff) {
      this.handoffSlot.set(null);
    }
    return handoff;
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
