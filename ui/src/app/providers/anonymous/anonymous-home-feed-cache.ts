import { computed, Injectable, signal } from '@angular/core';
import { Status } from '../../models';

const STORAGE_KEY = 'mockingbird_anonymous_home_feed';
const STATE_VERSION = 1;
const CACHE_LIMIT = 500;

interface AnonymousHomeFeedState {
  version: typeof STATE_VERSION;
  statuses: Status[];
  populatedAt: string | null;
}

function emptyState(): AnonymousHomeFeedState {
  return { version: STATE_VERSION, statuses: [], populatedAt: null };
}

function loadState(): AnonymousHomeFeedState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<AnonymousHomeFeedState> | null;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.statuses)) return emptyState();
    const statuses = parsed.statuses.filter(
      (status): status is Status =>
        typeof status?.id === 'string' && typeof status.account?.username === 'string',
    );
    return {
      version: STATE_VERSION,
      statuses: statuses.slice(0, CACHE_LIMIT),
      populatedAt:
        statuses.length && typeof parsed.populatedAt === 'string' ? parsed.populatedAt : null,
    };
  } catch {
    return emptyState();
  }
}

/** Persisted snapshot used to avoid rebuilding Anonymous Home on every visit. */
@Injectable({ providedIn: 'root' })
export class AnonymousHomeFeedCache {
  private state = signal(loadState());

  readonly statuses = computed(() => this.state().statuses);
  readonly populated = computed(
    () => this.state().populatedAt !== null && this.statuses().length > 0,
  );

  store(statuses: Status[]): void {
    if (!statuses.length) return;
    const state: AnonymousHomeFeedState = {
      version: STATE_VERSION,
      statuses: statuses.slice(0, CACHE_LIMIT),
      populatedAt: new Date().toISOString(),
    };
    this.state.set(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A memory-only snapshot still avoids repeat work during this app session.
    }
  }

  invalidate(): void {
    this.state.set(emptyState());
    localStorage.removeItem(STORAGE_KEY);
  }
}
