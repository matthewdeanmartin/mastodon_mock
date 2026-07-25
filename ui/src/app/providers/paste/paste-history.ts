import { inject, Injectable, signal } from '@angular/core';
import { PageDiagnostics } from '../../page-diagnostics';
import { PasteCreateInput, PasteCreated } from './paste-provider';

const PASTES_KEY = 'mockingbird_pastes';

export interface PasteRecord extends PasteCreateInput, PasteCreated {
  providerId: string;
  providerLabel: string;
  createdAt: string;
}

function load(): PasteRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PASTES_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as PasteRecord[]) : [];
  } catch {
    return [];
  }
}

/** Pastes and their one-shot edit keys, retained only in this browser. */
@Injectable({ providedIn: 'root' })
export class PasteHistory {
  private diagnostics = inject(PageDiagnostics);

  readonly records = signal<PasteRecord[]>(load());
  /**
   * Set when the last write could not be fully saved to localStorage (quota).
   * A paste link that isn't persisted is unrecoverable once the tab closes, so
   * this is surfaced to the user rather than swallowed. Null when all is well.
   */
  readonly persistError = signal<string | null>(null);

  add(
    providerId: string,
    providerLabel: string,
    input: PasteCreateInput,
    created: PasteCreated,
  ): PasteRecord {
    const record: PasteRecord = {
      providerId,
      providerLabel,
      ...input,
      ...created,
      createdAt: new Date().toISOString(),
    };
    this.persist([record, ...this.records()]);
    return record;
  }

  update(slug: string, changes: Partial<PasteRecord>): void {
    this.persist(
      this.records().map((record) => (record.slug === slug ? { ...record, ...changes } : record)),
    );
  }

  remove(slug: string): void {
    this.persist(this.records().filter((record) => record.slug !== slug));
  }

  /**
   * Save `records` (newest first) to localStorage. On a quota failure we do NOT
   * silently drop the write — losing a paste link is unrecoverable. Instead we
   * evict the OLDEST entries (least valuable; their remote pastes may already be
   * gone) and retry, keeping the just-created paste. If even a trimmed list will
   * not fit, we report it so the user can act. The in-memory signal always holds
   * the full list for this session regardless.
   */
  private persist(records: PasteRecord[]): void {
    this.records.set(records);
    if (this.tryWrite(records)) {
      this.persistError.set(null);
      return;
    }

    // Drop oldest entries (end of the array) until it fits, preserving the newest.
    for (let keep = records.length - 1; keep >= 1; keep--) {
      const trimmed = records.slice(0, keep);
      if (this.tryWrite(trimmed)) {
        const dropped = records.length - keep;
        this.diagnostics.warn('Paste', 'history:evicted-to-fit', {
          dropped,
          kept: keep,
        });
        this.persistError.set(
          `Local storage is full: the ${dropped} oldest saved paste ${
            dropped === 1 ? 'link was' : 'links were'
          } dropped to keep the newest. Copy any links you still need.`,
        );
        return;
      }
    }

    // Not even the single newest paste fits — nothing was written to disk.
    this.diagnostics.error('Paste', 'history:persist-failed', new Error('localStorage quota'), {
      records: records.length,
    });
    this.persistError.set(
      'Local storage is full — this paste link could not be saved and will be lost when you ' +
        'close the tab. Copy the link now, then free up space (clear old drafts or cached data).',
    );
  }

  private tryWrite(records: PasteRecord[]): boolean {
    try {
      localStorage.setItem(PASTES_KEY, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }
}
