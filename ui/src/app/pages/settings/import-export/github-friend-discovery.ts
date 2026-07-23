import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../../api';
import { Account } from '../../../models';
import { GitHubFollowedUser, GitHubSession } from '../../../providers/github/github-session';

export type GitHubFriendStatus = 'pending' | 'searching' | 'complete' | 'failed';
export type GitHubFriendConfidence = 'confirmed' | 'probable' | 'candidate';

export interface MastodonIdentity {
  handle: string;
  url: string;
  evidence: string;
  confidence: 'confirmed' | 'probable';
}

export interface GitHubFriendMatch {
  account: Account;
  handle: string;
  signals: string[];
  confidence: GitHubFriendConfidence;
}

export interface GitHubFriendRow {
  profile: GitHubFollowedUser;
  status: GitHubFriendStatus;
  identity: MastodonIdentity | null;
  matches: GitHubFriendMatch[];
  error?: string;
}

/**
 * Resolve identities already published in GitHub profile metadata.
 *
 * GitHub exposes social-account and website links through GraphQL. Those links
 * are the rel=me-style evidence; they do not need a Mastodon search to turn a
 * Mastodon profile URL into an importable fediverse handle.
 */
export function profileMastodonIdentity(profile: GitHubFollowedUser): MastodonIdentity | null {
  for (const social of profile.socialAccounts.nodes) {
    const identity = mastodonIdentity(social.url, 'Mastodon profile linked from GitHub');
    if (identity) return { ...identity, confidence: 'confirmed' };
  }

  if (profile.websiteUrl) {
    const identity = mastodonIdentity(
      profile.websiteUrl,
      'Mastodon profile used as GitHub website',
    );
    if (identity) return { ...identity, confidence: 'confirmed' };
  }

  const bioIdentity = mastodonIdentityFromText(profile.bio ?? '');
  return bioIdentity
    ? {
        ...bioIdentity,
        evidence: 'Mastodon address written in GitHub bio',
        confidence: 'probable',
      }
    : null;
}

/** Rank a Mastodon username-search result against public GitHub identity clues. */
export function rankGitHubMatch(profile: GitHubFollowedUser, account: Account): GitHubFriendMatch {
  const signals: string[] = [];
  const login = normalizeUsername(profile.login);
  const username = normalizeUsername(account.username);
  const displayName = normalize(profile.name ?? '');
  const accountName = normalize(account.display_name);
  const githubUrl = profile.url.toLowerCase().replace(/\/$/, '');
  const profileText =
    `${account.note} ${account.fields.map((field) => field.value).join(' ')}`.toLowerCase();
  const verifiedGitHubLink = account.fields.some(
    (field) =>
      !!field.verified_at && field.value.toLowerCase().replace(/\/$/, '').includes(githubUrl),
  );

  if (login && username === login) signals.push('Mastodon username matches GitHub login');
  if (displayName && accountName === displayName) signals.push('Display name exactly matches');
  if (verifiedGitHubLink) signals.push('Verified rel=me link back to GitHub');
  else if (profileText.includes(githubUrl)) signals.push('Mastodon profile links back to GitHub');
  if (
    profile.websiteUrl &&
    profileText.includes(profile.websiteUrl.toLowerCase().replace(/\/$/, ''))
  ) {
    signals.push('Website appears on both profiles');
  }

  const confidence: GitHubFriendConfidence = verifiedGitHubLink
    ? 'confirmed'
    : signals.length >= 2
      ? 'probable'
      : 'candidate';
  return { account, handle: accountHandle(account), signals, confidence };
}

/** Browser-only GitHub-to-Mastodon discovery with a resumable Mastodon API-call budget. */
@Injectable({ providedIn: 'root' })
export class GitHubFriendDiscovery {
  private github = inject(GitHubSession);
  private api = inject(Api);
  private stopRequested = false;

  readonly rows = signal<GitHubFriendRow[]>([]);
  readonly loading = signal(false);
  readonly running = signal(false);
  readonly callCount = signal(0);
  readonly githubPageCount = signal(0);
  readonly loadError = signal<string | null>(null);
  /** Small courtesy delay between Mastodon searches; tests set this to zero. */
  delayMs = 350;

  async load(): Promise<void> {
    if (this.loading() || this.running()) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.stopRequested = false;
    this.callCount.set(0);
    this.githubPageCount.set(0);
    try {
      const profiles: GitHubFollowedUser[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      while (true) {
        const page = await this.github.followedUsers(cursor);
        this.githubPageCount.update((count) => count + 1);
        for (const profile of page.users) {
          if (!seen.has(profile.login.toLowerCase())) {
            seen.add(profile.login.toLowerCase());
            profiles.push(profile);
          }
        }
        if (!page.hasNextPage) break;
        if (!page.endCursor || page.endCursor === cursor) {
          throw new Error('GitHub pagination did not advance.');
        }
        cursor = page.endCursor;
      }
      this.rows.set(
        profiles.map((profile) => {
          const identity = profileMastodonIdentity(profile);
          return {
            profile,
            status: identity ? ('complete' as const) : ('pending' as const),
            identity,
            matches: [],
          };
        }),
      );
    } catch (error: unknown) {
      this.loadError.set(
        error instanceof Error ? error.message : "Couldn't load the people you follow on GitHub.",
      );
    } finally {
      this.loading.set(false);
    }
  }

  reset(): void {
    this.stopRequested = true;
    this.rows.set([]);
    this.loading.set(false);
    this.running.set(false);
    this.callCount.set(0);
    this.githubPageCount.set(0);
    this.loadError.set(null);
  }

  stop(): void {
    this.stopRequested = true;
  }

  async start(callLimit: number): Promise<void> {
    if (this.loading() || this.running() || this.callCount() >= callLimit) return;
    this.stopRequested = false;
    this.running.set(true);
    try {
      for (let rowIndex = 0; rowIndex < this.rows().length; rowIndex++) {
        if (this.stopRequested || this.callCount() >= callLimit) break;
        const row = this.rows()[rowIndex];
        if (row.status === 'complete' || row.status === 'failed') continue;
        await this.searchRow(rowIndex);
      }
    } finally {
      this.running.set(false);
    }
  }

  private async searchRow(rowIndex: number): Promise<void> {
    const row = this.rows()[rowIndex];
    this.patch(rowIndex, { status: 'searching', error: undefined });
    this.callCount.update((count) => count + 1);
    try {
      const result = await firstValueFrom(
        this.api.search(row.profile.login, 'accounts', { resolve: false, limit: 10 }),
      );
      const matches = (result.accounts ?? [])
        .map((account) => rankGitHubMatch(row.profile, account))
        .filter((match) => match.signals.length > 0)
        .sort(
          (a, b) =>
            confidenceOrder(a.confidence) - confidenceOrder(b.confidence) ||
            b.signals.length - a.signals.length ||
            a.account.acct.localeCompare(b.account.acct),
        )
        .slice(0, 5);
      this.patch(rowIndex, { status: 'complete', matches });
    } catch (error: unknown) {
      const status = (error as HttpErrorResponse)?.status;
      this.patch(rowIndex, {
        status: 'failed',
        error:
          status === 429
            ? 'The server is rate limiting searches. Try again later.'
            : 'Mastodon search request failed.',
      });
      if (status === 429) this.stopRequested = true;
    }
    if (!this.stopRequested && this.delayMs) await delay(this.delayMs);
  }

  private patch(index: number, changes: Partial<GitHubFriendRow>): void {
    this.rows.update((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)),
    );
  }
}

function mastodonIdentity(
  value: string,
  evidence: string,
): Omit<MastodonIdentity, 'confidence'> | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const match = url.pathname.match(/^\/(?:@|users\/)([\w.-]+)\/?$/i);
    if (!match) return null;
    return {
      handle: `${match[1]}@${url.hostname}`.toLowerCase(),
      url: url.toString(),
      evidence,
    };
  } catch {
    return null;
  }
}

function mastodonIdentityFromText(text: string): Omit<MastodonIdentity, 'confidence'> | null {
  const urlMatch = text.match(/https?:\/\/[\w.-]+\/(?:@|users\/)[\w.-]+\/?/i);
  if (urlMatch) return mastodonIdentity(urlMatch[0], '');
  const handleMatch = text.match(/(?:^|[\s(])@([\w.-]+)@([\w.-]+\.[a-z]{2,})(?=$|[\s),;])/i);
  if (!handleMatch) return null;
  return {
    handle: `${handleMatch[1]}@${handleMatch[2]}`.toLowerCase(),
    url: `https://${handleMatch[2]}/@${handleMatch[1]}`,
    evidence: '',
  };
}

function accountHandle(account: Account): string {
  const acct = account.acct.replace(/^@/, '');
  if (acct.includes('@')) return acct;
  try {
    return `${acct}@${new URL(account.url).hostname}`;
  } catch {
    return acct;
  }
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

function confidenceOrder(confidence: GitHubFriendConfidence): number {
  return confidence === 'confirmed' ? 0 : confidence === 'probable' ? 1 : 2;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
