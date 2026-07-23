import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../../api';
import { Account } from '../../../models';

export type ContactSearchStatus = 'pending' | 'searching' | 'complete' | 'failed';

export interface ContactSearchQuery {
  text: string;
  resolve: boolean;
  label: string;
}

export interface SearchableContact {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  organization: string;
  emailUsernames: string[];
  emailDomains: string[];
  websiteDomains: string[];
  handles: string[];
  queries: ContactSearchQuery[];
}

export interface ContactMatch {
  account: Account;
  signals: string[];
  confidence: 'likely' | 'possible' | 'weak';
}

export interface ContactSearchRow {
  contact: SearchableContact;
  status: ContactSearchStatus;
  completedQueries: number;
  matches: ContactMatch[];
  error?: string;
}

export interface ContactParseResult {
  contacts: SearchableContact[];
  total: number;
  skipped: number;
}

type CsvRecord = Record<string, string>;

/** Parse an RFC 4180-style CSV, including quoted commas, quotes, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

/** Convert a Google Contacts CSV into only the contacts worth querying. */
export function parseContacts(text: string): ContactParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { contacts: [], total: 0, skipped: 0 };
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  const records = rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])),
    );
  const contacts = records.flatMap((record, index) => {
    const contact = contactFromRecord(record, index + 1);
    return contact ? [contact] : [];
  });
  return { contacts, total: records.length, skipped: records.length - contacts.length };
}

function contactFromRecord(record: CsvRecord, id: number): SearchableContact | null {
  const firstName = record['First Name'] ?? '';
  const middleName = record['Middle Name'] ?? '';
  const lastName = record['Last Name'] ?? '';
  const name = [firstName, middleName, lastName].filter(Boolean).join(' ');
  const organization = record['Organization Name'] ?? '';
  const emails = numberedValues(record, 'E-mail', 'Value');
  const websites = numberedValues(record, 'Website', 'Value');
  // Google exports custom fields under user-defined headers, so scan every cell for
  // unambiguous @user@host values and profile URLs. Ordinary email addresses do not
  // match the handle pattern because it requires the leading @.
  const clueText = Object.values(record).join(' ');
  const handles = extractHandles(clueText);
  const hasPersonName = plausibleName(firstName) && plausibleName(lastName);
  if (!handles.length && !hasPersonName) return null;

  const emailUsernames = unique(
    emails
      .map((email) => email.split('@')[0]?.toLowerCase())
      .filter((value) => plausibleUsername(value)),
  );
  const emailDomains = unique(emails.map(domainFromEmail).filter(isString));
  const websiteDomains = unique(websites.map(domainFromUrl).filter(isString));
  const queries: ContactSearchQuery[] = [];
  for (const handle of handles.slice(0, 2)) {
    queries.push({ text: handle, resolve: true, label: `exact handle @${handle}` });
  }
  if (!queries.length) {
    const username = preferredEmailUsername(emailUsernames, firstName, lastName);
    if (username) queries.push({ text: username, resolve: false, label: `username ${username}` });
    queries.push({ text: name, resolve: false, label: `name ${name}` });
  }

  return {
    id,
    name: name || organization || handles[0],
    firstName,
    lastName,
    organization,
    emailUsernames,
    emailDomains,
    websiteDomains,
    handles,
    queries: dedupeQueries(queries).slice(0, 2),
  };
}

function numberedValues(record: CsvRecord, prefix: string, suffix: string): string[] {
  return Object.entries(record)
    .filter(
      ([column, value]) =>
        column.startsWith(`${prefix} `) && column.endsWith(` - ${suffix}`) && value,
    )
    .map(([, value]) => value);
}

function plausibleName(value: string): boolean {
  return value.trim().length >= 2 && /[\p{L}]/u.test(value) && !/^\+?[\d\s().-]+$/.test(value);
}

function plausibleUsername(value: string | undefined): value is string {
  return !!value && /^[\w.+-]{2,64}$/i.test(value);
}

function preferredEmailUsername(
  usernames: string[],
  firstName: string,
  lastName: string,
): string | undefined {
  const first = normalize(firstName);
  const last = normalize(lastName);
  const expected = new Set([
    `${first}.${last}`,
    `${first}_${last}`,
    `${first}-${last}`,
    `${first}${last}`,
  ]);
  return usernames.find((username) => expected.has(normalizeUsername(username))) ?? usernames[0];
}

function extractHandles(text: string): string[] {
  const handles: string[] = [];
  const urlPattern = /https?:\/\/([\w.-]+)\/(?:@|users\/)([\w.-]+)/gi;
  const handlePattern = /(?:^|[\s(])@([\w.-]+)@([\w.-]+\.[a-z]{2,})(?=$|[\s),;])/gi;
  for (const match of text.matchAll(urlPattern))
    handles.push(`${match[2]}@${match[1]}`.toLowerCase());
  for (const match of text.matchAll(handlePattern))
    handles.push(`${match[1]}@${match[2]}`.toLowerCase());
  return unique(handles);
}

function domainFromEmail(email: string): string | null {
  const domain = email.split('@').at(-1)?.toLowerCase();
  return domain?.includes('.') ? domain : null;
}

function domainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function dedupeQueries(queries: ContactSearchQuery[]): ContactSearchQuery[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = query.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function isString(value: string | null): value is string {
  return value !== null;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

/** Explain every independent clue connecting an account result to a contact. */
export function rankMatch(contact: SearchableContact, account: Account): ContactMatch {
  const signals: string[] = [];
  const acct = account.acct.replace(/^@/, '').toLowerCase();
  const username = account.username.toLowerCase();
  const accountDomain = acct.includes('@') ? acct.split('@').at(-1)! : '';
  const displayName = normalize(account.display_name);
  const fullName = normalize(contact.name);
  const first = normalize(contact.firstName);
  const last = normalize(contact.lastName);

  if (contact.handles.some((handle) => handle === acct)) signals.push('Exact Mastodon handle');
  if (contact.emailUsernames.includes(username)) signals.push('Username matches email name');
  if (fullName && displayName === fullName) signals.push('Display name exactly matches');
  else if (first && last && displayName.includes(first) && displayName.includes(last)) {
    signals.push('Display name contains first and last name');
  }
  const nameUsernames = [
    `${first}.${last}`,
    `${first}_${last}`,
    `${first}-${last}`,
    `${first}${last}`,
  ];
  if (first && last && nameUsernames.includes(normalizeUsername(username))) {
    signals.push('Username matches contact name');
  }
  if (accountDomain && contact.emailDomains.includes(accountDomain))
    signals.push('Account and email domains match');

  const profileDomains = [account.url, ...account.fields.map((field) => field.value)]
    .flatMap((value) => [...value.matchAll(/https?:\/\/([^/\s<"']+)/gi)].map((match) => match[1]))
    .map((domain) => domain.toLowerCase().replace(/^www\./, ''));
  if (contact.websiteDomains.some((domain) => profileDomains.includes(domain))) {
    signals.push('Website appears on profile');
  }
  if (contact.organization && normalize(account.note).includes(normalize(contact.organization))) {
    signals.push('Organization appears in bio');
  }

  const confidence =
    signals.includes('Exact Mastodon handle') || signals.length >= 3
      ? 'likely'
      : signals.length >= 2
        ? 'possible'
        : 'weak';
  return { account, signals, confidence };
}

/** Browser-only, sequential contact discovery through the authenticated home server. */
@Injectable({ providedIn: 'root' })
export class ContactDiscovery {
  private api = inject(Api);
  private stopRequested = false;

  readonly rows = signal<ContactSearchRow[]>([]);
  readonly running = signal(false);
  readonly callCount = signal(0);
  readonly parseResult = signal<ContactParseResult | null>(null);
  /** Small courtesy delay between successful calls; tests set this to zero. */
  delayMs = 350;

  load(text: string): void {
    const result = parseContacts(text);
    this.stopRequested = false;
    this.running.set(false);
    this.callCount.set(0);
    this.parseResult.set(result);
    this.rows.set(
      result.contacts.map((contact) => ({
        contact,
        status: 'pending' as const,
        completedQueries: 0,
        matches: [],
      })),
    );
  }

  reset(): void {
    this.stopRequested = true;
    this.rows.set([]);
    this.running.set(false);
    this.callCount.set(0);
    this.parseResult.set(null);
  }

  stop(): void {
    this.stopRequested = true;
  }

  async start(callLimit: number): Promise<void> {
    if (this.running() || this.callCount() >= callLimit) return;
    this.stopRequested = false;
    this.running.set(true);
    try {
      for (let rowIndex = 0; rowIndex < this.rows().length; rowIndex++) {
        if (this.stopRequested || this.callCount() >= callLimit) break;
        await this.searchRow(rowIndex, callLimit);
      }
    } finally {
      this.running.set(false);
    }
  }

  private async searchRow(rowIndex: number, callLimit: number): Promise<void> {
    const row = this.rows()[rowIndex];
    if (row.status === 'complete' || row.status === 'failed') return;
    this.patch(rowIndex, { status: 'searching', error: undefined });
    const found = new Map(
      row.matches.map((match) => [match.account.id || match.account.acct, match.account]),
    );

    for (
      let queryIndex = row.completedQueries;
      queryIndex < row.contact.queries.length;
      queryIndex++
    ) {
      if (this.stopRequested || this.callCount() >= callLimit) {
        this.patch(rowIndex, { status: 'pending' });
        return;
      }
      const query = row.contact.queries[queryIndex];
      this.callCount.update((count) => count + 1);
      try {
        const results = await firstValueFrom(
          this.api.search(query.text, 'accounts', { resolve: query.resolve, limit: 10 }),
        );
        for (const account of results.accounts ?? [])
          found.set(account.id || account.acct, account);
        this.patch(rowIndex, { completedQueries: queryIndex + 1 });
      } catch (error) {
        const status = (error as HttpErrorResponse)?.status;
        this.patch(rowIndex, {
          status: 'failed',
          error:
            status === 429
              ? 'The server is rate limiting searches. Try again later.'
              : 'Search request failed.',
        });
        if (status === 429) this.stopRequested = true;
        return;
      }
      if (!this.stopRequested && this.delayMs) await delay(this.delayMs);
    }

    const matches = [...found.values()]
      .map((account) => rankMatch(row.contact, account))
      .filter((match) => match.signals.length > 0)
      .sort(
        (a, b) =>
          b.signals.length - a.signals.length || a.account.acct.localeCompare(b.account.acct),
      );
    this.patch(rowIndex, { status: 'complete', matches });
  }

  private patch(index: number, changes: Partial<ContactSearchRow>): void {
    this.rows.update((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
