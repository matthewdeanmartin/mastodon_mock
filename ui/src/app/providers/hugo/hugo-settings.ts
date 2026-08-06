import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';
import { normalizeContentPath, predictedPermalink } from './hugo-post';

/**
 * The Hugo repo this account publishes to, and the token that may write to it.
 *
 * Split into two localStorage keys the same way {@link GitHubSession} is, and
 * for the same reason: a settings export can carry "which repo is my blog"
 * without carrying a write credential. The repo coordinates are `private`, the
 * token is `secret`. See `storage-registry.ts`.
 *
 * **This token is deliberately not the one `GitHubSession` holds.** That one is
 * a read-only PAT for notifications and profile lookups; this one can write to
 * a repository. Sharing a single token would mean silently widening the scope
 * an existing user's connection needs, and would put every repo they own behind
 * one leaked string. A fine-grained token scoped to the one Hugo repo is the
 * whole point — see `sprint/hugo-0-overview.md`, decision 1.
 */
const REPO_KEY_BASE = 'mockingbird_hugo_repo';
const CREDENTIALS_KEY_BASE = 'mockingbird_hugo_credentials';

/** Hugo's own default, and the archetype path `hugo new` writes into. */
export const DEFAULT_CONTENT_PATH = 'content/posts';

/** The half that identifies the blog. Safe to export; not a secret. */
export interface HugoRepo {
  owner: string;
  repo: string;
  /** The branch the site is built from. */
  branch: string;
  /** Repo-relative folder holding the posts, normalized (no leading slash). */
  contentPath: string;
  /**
   * The public address of the built site, or null.
   *
   * Optional on purpose: it is needed only to *predict* a permalink and to find
   * the RSS feed (sprint 3). Publishing works without it, and a wrong guess is
   * worse than linking to the file on GitHub.
   */
  siteUrl: string | null;
  /** Show this blog's posts on the Mawkingbird profile (sprint 3). */
  includeInProfile: boolean;
}

interface StoredCredentials extends ExpiringCredential {
  accessToken: string;
}

function loadRepo(key: string): HugoRepo | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<HugoRepo> | null;
    if (
      !parsed ||
      typeof parsed.owner !== 'string' ||
      typeof parsed.repo !== 'string' ||
      !parsed.owner ||
      !parsed.repo
    ) {
      return null;
    }
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: typeof parsed.branch === 'string' && parsed.branch ? parsed.branch : 'main',
      contentPath:
        typeof parsed.contentPath === 'string' && parsed.contentPath
          ? parsed.contentPath
          : DEFAULT_CONTENT_PATH,
      siteUrl: typeof parsed.siteUrl === 'string' && parsed.siteUrl ? parsed.siteUrl : null,
      includeInProfile: parsed.includeInProfile === true,
    };
  } catch {
    return null;
  }
}

function loadCredentials(key: string): StoredCredentials | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(key) ?? 'null',
    ) as Partial<StoredCredentials> | null;
    if (typeof parsed?.accessToken !== 'string' || !parsed.accessToken) {
      return null;
    }
    const stamped = ensureStamped(key, parsed as StoredCredentials);
    if (credentialExpired(stamped.connectedAt)) {
      localStorage.removeItem(key);
      return null;
    }
    return stamped;
  } catch {
    return null;
  }
}

/** One Hugo-on-GitHub blog linked to the current Mawkingbird account. */
@Injectable({ providedIn: 'root' })
export class HugoSettings implements ExpiringConnection {
  private readonly repoKey = scopedKey(REPO_KEY_BASE);
  private readonly credentialsKey = scopedKey(CREDENTIALS_KEY_BASE);

  private readonly repoState = signal<HugoRepo | null>(loadRepo(this.repoKey));
  private readonly credentials = signal<StoredCredentials | null>(
    loadCredentials(this.credentialsKey),
  );

  readonly repo = this.repoState.asReadonly();

  /**
   * Connected means *both* halves are present.
   *
   * The repo can outlive the token — that is exactly the state a machine is in
   * after importing settings but before pasting a token — and in that state
   * nothing can be published, so the composer must not offer the target.
   */
  readonly connected = computed(() => this.repoState() !== null && this.credentials() !== null);

  /** `owner/repo`, for display. */
  readonly slug = computed(() => {
    const repo = this.repoState();
    return repo ? `${repo.owner}/${repo.repo}` : null;
  });

  readonly siteUrl = computed(() => this.repoState()?.siteUrl ?? null);
  readonly includeInProfile = computed(() => this.repoState()?.includeInProfile === true);

  /**
   * The site's RSS feed, Hugo's default location (sprint 3).
   *
   * Mirrors `MataroaSettings.feedUrl`, which the profile page already consumes.
   */
  readonly feedUrl = computed(() => {
    const siteUrl = this.siteUrl();
    if (!siteUrl) {
      return null;
    }
    try {
      return new URL('index.xml', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`).toString();
    } catch {
      return null;
    }
  });

  /** The write token, or null. Only the contents API should need this. */
  token(): string | null {
    return this.credentials()?.accessToken ?? null;
  }

  /**
   * Where a slug will live on the built site, or null with no site address.
   *
   * A convenience over {@link predictedPermalink} so callers do not each have
   * to unpack the repo to pass its content path and site URL.
   */
  permalinkFor(slug: string): string | null {
    const repo = this.repoState();
    return repo ? predictedPermalink(repo.siteUrl, repo.contentPath, slug) : null;
  }

  /**
   * Persist a validated connection.
   *
   * Callers validate against the live API *first* — a stored connection that
   * points at a repo that does not exist is worse than no connection, because
   * the composer will offer a target that can only fail.
   */
  connect(token: string, repo: HugoRepo): void {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error('Paste a GitHub token with write access to your blog repository.');
    }
    const normalized: HugoRepo = { ...repo, contentPath: normalizeContentPath(repo.contentPath) };
    const credentials = stampCredential({ accessToken: trimmed });
    localStorage.setItem(this.repoKey, JSON.stringify(normalized));
    localStorage.setItem(this.credentialsKey, JSON.stringify(credentials));
    this.repoState.set(normalized);
    this.credentials.set(credentials);
  }

  setIncludeInProfile(include: boolean): void {
    const current = this.repoState();
    if (!current) {
      return;
    }
    const next = { ...current, includeInProfile: include };
    localStorage.setItem(this.repoKey, JSON.stringify(next));
    this.repoState.set(next);
  }

  disconnect(): void {
    localStorage.removeItem(this.repoKey);
    localStorage.removeItem(this.credentialsKey);
    this.repoState.set(null);
    this.credentials.set(null);
  }

  expiresAt(): number | null {
    return credentialExpiresAt(this.credentials()?.connectedAt);
  }

  enforceLifetime(): void {
    const current = this.credentials();
    if (current && credentialExpired(current.connectedAt)) {
      // Only the token ages out. The repo coordinates are not a secret, and
      // keeping them means reconnecting is one paste rather than a form.
      localStorage.removeItem(this.credentialsKey);
      this.credentials.set(null);
    }
  }
}

/**
 * Pull `owner` and `repo` out of whatever the user pasted.
 *
 * They paste a full GitHub URL, or `owner/repo`, or fill the two boxes
 * separately. All three are the same intent and the form should not care.
 */
export function parseRepoInput(value: string): { owner: string; repo: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withoutHost = trimmed
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = withoutHost.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}

/** Normalize the public site address, or null if the user left it blank. */
export function normalizeSiteUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  // Reject a wrong scheme before defaulting one, or `ftp://example.com` gets
  // silently mangled into `https://ftp//example.com` rather than refused.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    throw new Error('The site address must start with https:// or http://.');
  }
  const withScheme = scheme ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid site address, for example https://you.github.io/blog/.');
  }
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}
