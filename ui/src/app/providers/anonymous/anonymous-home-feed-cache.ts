import { computed, Injectable, signal } from '@angular/core';
import { Status } from '../../models';

const STORAGE_KEY = 'mockingbird_anonymous_home_feed';
const STATE_VERSION = 2;
const CACHE_LIMIT = 500;

interface AnonymousHomeFeedState {
  version: typeof STATE_VERSION;
  statuses: Status[];
  populatedAt: string | null;
  sourceKey: string;
}

function emptyState(): AnonymousHomeFeedState {
  return { version: STATE_VERSION, statuses: [], populatedAt: null, sourceKey: '' };
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
      sourceKey: typeof parsed.sourceKey === 'string' ? parsed.sourceKey : '',
    };
  } catch {
    return emptyState();
  }
}

/** Persisted snapshot used to avoid rebuilding Anonymous Home on every visit. */
@Injectable({ providedIn: 'root' })
export class AnonymousHomeFeedCache {
  private state = signal(loadState());
  private generationValue = 0;

  readonly statuses = computed(() => this.state().statuses);
  readonly populated = computed(
    () => this.state().populatedAt !== null && this.statuses().length > 0,
  );

  generation(): number {
    return this.generationValue;
  }

  matchesSources(sourceKey: string): boolean {
    return this.populated() && this.state().sourceKey === sourceKey;
  }

  store(statuses: Status[], sourceKey = '', generation = this.generationValue): void {
    if (!statuses.length || generation !== this.generationValue) return;
    const state: AnonymousHomeFeedState = {
      version: STATE_VERSION,
      statuses: statuses.slice(0, CACHE_LIMIT),
      populatedAt: new Date().toISOString(),
      sourceKey,
    };
    this.state.set(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A memory-only snapshot still avoids repeat work during this app session.
    }
  }

  invalidate(): void {
    this.generationValue += 1;
    this.state.set(emptyState());
    localStorage.removeItem(STORAGE_KEY);
  }
}
