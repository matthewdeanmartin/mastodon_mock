import { inject, Injectable } from '@angular/core';
import { Account, Status } from '../../models';
import { HugoApiError, HugoContents } from './hugo-contents';
import { FrontMatterFormat, serializeFrontMatter, tagsFromBody } from './hugo-front-matter';
import { bumpSlug, hugoStatus, postPath, postSlug, predictedPermalink } from './hugo-post';
import { HugoSettings } from './hugo-settings';

/**
 * How many times a colliding slug is retried with a `-2`, `-3` suffix.
 *
 * Three in a row means something other than "I wrote about this twice" is going
 * on — a misconfigured content path pointing at a directory of unrelated files,
 * say — and looping harder would just make the eventual error later and
 * stranger.
 */
const MAX_SLUG_ATTEMPTS = 3;

export interface PublishRequest {
  title: string;
  body: string;
  isDraft: boolean;
  account: Account;
}

export interface PublishResult {
  status: Status;
  /** The slug actually used, which may not be the one the title implied. */
  slug: string;
  /** True when a collision pushed the post onto a numbered slug. */
  renamed: boolean;
}

/** Turns a composer submission into a commit, and the commit into a `Status`. */
@Injectable({ providedIn: 'root' })
export class HugoPublish {
  private readonly contents = inject(HugoContents);
  private readonly settings = inject(HugoSettings);

  /**
   * Publish a new post.
   *
   * Always a *create* — no `sha` is sent — so GitHub is the thing that decides
   * whether the slug is free. That is deliberate: a read-then-write existence
   * check races with anything else committing to the repo, whereas the 422 is
   * authoritative. Editing an existing post is sprint 2 and goes through a
   * different path.
   */
  async publish(request: PublishRequest): Promise<PublishResult> {
    const repo = this.settings.repo();
    if (!repo) {
      throw new Error('Connect your Hugo repository in Settings first.');
    }
    const title = request.title.trim();
    const body = request.body.trim();
    if (!title) {
      throw new Error('Give the post a title.');
    }
    if (!body) {
      throw new Error('Write something to publish.');
    }

    const baseSlug = postSlug(title);
    const file = serializeFrontMatter(
      {
        title,
        date: new Date().toISOString(),
        draft: request.isDraft,
        tags: tagsFromBody(body),
      },
      body,
      'toml' satisfies FrontMatterFormat,
    );

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = bumpSlug(baseSlug, attempt);
      try {
        const commit = await this.contents.putFile({
          path: postPath(repo.contentPath, slug),
          text: file,
          message: `${request.isDraft ? 'Draft' : 'Publish'}: ${title}`,
        });
        return {
          status: hugoStatus(commit, title, body, request.account, {
            slug,
            permalink: predictedPermalink(repo.siteUrl, repo.contentPath, slug),
            isDraft: request.isDraft,
          }),
          slug,
          renamed: attempt > 1,
        };
      } catch (error: unknown) {
        // 422 here means "that path already exists" — the one error worth
        // retrying, because the fix is mechanical. Anything else is the user's
        // to see.
        if (!(error instanceof HugoApiError && error.status === 422)) {
          throw error;
        }
        if (attempt === MAX_SLUG_ATTEMPTS) {
          throw new HugoApiError(
            422,
            `There are already posts named "${baseSlug}" in ${repo.contentPath}. Try a different title.`,
          );
        }
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new Error('Could not publish this post.');
  }
}
