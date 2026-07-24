import { Injectable, signal } from '@angular/core';
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
  readonly records = signal<PasteRecord[]>(load());

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

  private persist(records: PasteRecord[]): void {
    this.records.set(records);
    try {
      localStorage.setItem(PASTES_KEY, JSON.stringify(records));
    } catch {
      // A very large paste can exceed the browser quota. Keep this session usable.
    }
  }
}
