import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../api';
import { OpenRouterChat } from '../../providers/openrouter/openrouter-chat';
import { PromptTemplateStore } from '../../providers/openrouter/prompt-templates';

/**
 * Prose in, a runnable Mastodon search query out.
 *
 * The interesting part is the grading, and the rule is Matthew's: **try the
 * suggestions in order and stop at the first one that works.** The obvious
 * design — run all five, then decide — costs five API calls every single time,
 * in a codebase whose search page has an explicit API-call budget precisely
 * because that sort of thing adds up (`sprint/search-3-budget-and-pagination.md`).
 * Short-circuiting makes the common case one call.
 *
 * This works because the prompt asks for suggestions ordered most-to-least
 * likely. Walking that order and stopping early means the first query that
 * returns anything is also the most specific one that does — which is the one
 * the user wanted. The ordering used to be decorative; here it carries weight.
 */

/** A query "works" when it returns at least this many results. */
export const SEARCH_SUCCESS_THRESHOLD = 5;

/** How many candidates to ask for, and therefore the worst-case probe count. */
export const SEARCH_QUERY_COUNT = 5;

/** Results per probe: we only need to know whether the threshold was cleared. */
const PROBE_LIMIT = SEARCH_SUCCESS_THRESHOLD;

export interface GradedQuery {
  query: string;
  /** Results returned, or null when the probe itself failed. */
  count: number | null;
}

export interface GradeOutcome {
  /** Every query actually tried, in order. Untried ones are absent by design. */
  attempts: GradedQuery[];
  /** The first query to clear the threshold, or null when none did. */
  winner: string | null;
  /** API calls spent. Equals `attempts.length`; named for the caller's benefit. */
  callsUsed: number;
}

export interface SearchHelperResult {
  /** The candidates behind the outcome — the refined set when one was needed. */
  queries: string[];
  attempts: GradedQuery[];
  winner: string | null;
  /** True when the first set all failed and the model was asked again. */
  refined: boolean;
  /** Total probes across both passes. */
  callsUsed: number;
}

/**
 * Try each query in turn, stopping at the first success.
 *
 * `run` returns the result count for one query. A probe that throws is recorded
 * as `count: null` and the walk continues — one flaky request should not
 * discard four perfectly good candidates.
 */
export async function gradeUntilSuccess(
  queries: string[],
  run: (query: string) => Promise<number>,
  options: { threshold?: number; maxCalls?: number } = {},
): Promise<GradeOutcome> {
  const threshold = options.threshold ?? SEARCH_SUCCESS_THRESHOLD;
  const maxCalls = options.maxCalls ?? SEARCH_QUERY_COUNT;

  const attempts: GradedQuery[] = [];
  for (const query of queries) {
    if (attempts.length >= maxCalls) {
      break;
    }
    let count: number | null;
    try {
      count = await run(query);
    } catch {
      count = null;
    }
    attempts.push({ query, count });
    if (count !== null && count >= threshold) {
      return { attempts, winner: query, callsUsed: attempts.length };
    }
  }
  return { attempts, winner: null, callsUsed: attempts.length };
}

/**
 * The `{{feedback}}` block for the refine pass.
 *
 * Only ever built when everything failed, so it says so plainly and hands the
 * model the counts. Naming the failure mode ("too narrow") is worth more than
 * the numbers alone — the model cannot see that `+rust +compiler +bootstrap`
 * is three ANDed terms, but it can act on "these were too narrow".
 */
export function describeAttempts(
  attempts: GradedQuery[],
  threshold: number = SEARCH_SUCCESS_THRESHOLD,
): string {
  if (attempts.length === 0) {
    return '';
  }
  const lines = attempts.map((attempt) => {
    const outcome =
      attempt.count === null
        ? 'the search failed'
        : `${attempt.count} result${attempt.count === 1 ? '' : 's'}`;
    return `- ${attempt.query} → ${outcome}`;
  });
  return [
    `Your previous suggestions were tried in order. None returned ${threshold} or more results:`,
    ...lines,
    '',
    'They were too narrow. Suggest 5 different queries that are broader: drop the least',
    'important terms, remove operators that may not match, and prefer plain words.',
    'Do not repeat any query from the list above.',
  ].join('\n');
}

@Injectable({ providedIn: 'root' })
export class SearchHelper {
  private chat = inject(OpenRouterChat);
  private prompts = inject(PromptTemplateStore);
  private api = inject(Api);

  /**
   * Suggest, grade, and refine once if nothing worked.
   *
   * Refining is conditional on purpose: when the first pass already found a
   * query that returns results, a second round trip buys nothing and costs a
   * request plus a wait.
   */
  async run(request: string): Promise<SearchHelperResult> {
    const probe = (query: string) => this.countResults(query);

    const queries = await this.suggest(request, '');
    const first = await gradeUntilSuccess(queries, probe);
    if (first.winner) {
      return { queries, ...first, refined: false };
    }

    const feedback = describeAttempts(first.attempts);
    const refinedQueries = await this.suggest(request, feedback);
    const second = await gradeUntilSuccess(refinedQueries, probe);
    return {
      queries: refinedQueries,
      attempts: second.attempts,
      winner: second.winner,
      refined: true,
      callsUsed: first.callsUsed + second.callsUsed,
    };
  }

  private suggest(request: string, feedback: string): Promise<string[]> {
    return this.chat.suggest({
      prompt: this.prompts.render('search', { request, feedback }),
      schemaName: 'mastodon_search_queries',
      max: SEARCH_QUERY_COUNT,
    });
  }

  /** How many statuses one query returns, capped at the threshold we care about. */
  private async countResults(query: string): Promise<number> {
    const results = await firstValueFrom(
      this.api.search(query, 'statuses', { limit: PROBE_LIMIT }),
    );
    return results.statuses?.length ?? 0;
  }
}
