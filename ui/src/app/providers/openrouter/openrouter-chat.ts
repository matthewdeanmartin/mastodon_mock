import { inject, Injectable } from '@angular/core';
import { OpenRouterSession, openRouterError } from './openrouter-session';
import { OpenRouterModelChoice } from './openrouter-model-choice';
import {
  parseSuggestionReply,
  suggestionSchema,
  SuggestionParseError,
  SuggestionReply,
} from './json-suggestions';

/**
 * The one inference call in the app.
 *
 * Uses `POST /api/v1/chat/completions` rather than the Responses API: the
 * structured-output contract (`response_format: { type: 'json_schema', … }`) is
 * documented against chat completions, and `supported_parameters` — the filter
 * the model picker uses — describes chat-completions parameters. Filtering on
 * one API and calling another would be a quiet inconsistency.
 *
 * Everything this returns has been through {@link parseSuggestions}; callers
 * never see raw model output.
 */

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Suggestion lists are short. This is a guard against a runaway bill, not a limit. */
const MAX_TOKENS = 700;

/**
 * Appended on the retry when a provider rejected the schema outright, so the
 * second attempt still has a chance of being parseable.
 */
const JSON_ONLY_NUDGE =
  '\n\nReply with JSON only, in the form {"suggestions": ["...", "..."], "problem": ""}. ' +
  'No prose, no code fences.';

export interface SuggestOptions {
  /** The fully rendered prompt. */
  prompt: string;
  /** Schema name — appears in the request; useful in OpenRouter's logs. */
  schemaName: string;
  /** How many suggestions to ask for and accept. */
  max: number;
}

interface ChatResponse {
  choices?: { message?: { content?: unknown } }[];
}

@Injectable({ providedIn: 'root' })
export class OpenRouterChat {
  private session = inject(OpenRouterSession);
  private choice = inject(OpenRouterModelChoice);

  /**
   * Ask the chosen model for a list of suggestions.
   *
   * Retries once without `response_format` when the first attempt fails in a
   * way a schema could cause — a provider that rejects `json_schema`, or a
   * reply that came back unparseable. The retry carries an explicit
   * "JSON only" instruction instead.
   *
   * Returns the model's objection alongside its list: a request the DSL cannot
   * express is an answer, not a failure, and throwing would lose the sentence
   * that explains it.
   */
  async suggest(options: SuggestOptions): Promise<SuggestionReply> {
    const key = this.session.apiKey();
    if (!key) {
      throw new Error('Connect OpenRouter first.');
    }

    try {
      return await this.attempt(key, options, true);
    } catch (error: unknown) {
      if (!isRetryable(error)) {
        throw error;
      }
      return this.attempt(key, options, false);
    }
  }

  private async attempt(
    key: string,
    options: SuggestOptions,
    withSchema: boolean,
  ): Promise<SuggestionReply> {
    const body: Record<string, unknown> = {
      model: this.choice.modelId(),
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: withSchema ? options.prompt : options.prompt + JSON_ONLY_NUDGE,
        },
      ],
    };
    if (withSchema) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: suggestionSchema(options.schemaName, options.max),
      };
    }

    let response: Response;
    try {
      response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Couldn't reach OpenRouter.");
    }

    if (!response.ok) {
      throw new Error(await this.describeFailure(response));
    }

    const content = ((await response.json()) as ChatResponse).choices?.[0]?.message?.content;
    return parseSuggestionReply(content, options.max);
  }

  /** Turn an HTTP failure into something the user can act on. */
  private async describeFailure(response: Response): Promise<string> {
    if (response.status === 401) {
      // The key was revoked at OpenRouter. Stop claiming to be connected.
      this.session.disconnect();
      return 'OpenRouter no longer recognises this key. Connect again.';
    }
    if (response.status === 402) {
      return 'Your OpenRouter credits have run out. Top up at openrouter.ai, then try again.';
    }
    if (response.status === 429) {
      return 'OpenRouter is rate-limiting this key. Wait a moment and try again.';
    }
    return openRouterError(response, "OpenRouter couldn't answer that.");
  }
}

/**
 * Whether dropping the schema might help.
 *
 * A parse failure or a 400 both point at the schema; a 402 or a revoked key
 * would fail identically the second time, and retrying just burns another
 * request.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof SuggestionParseError) {
    return true;
  }
  return error instanceof Error && /response_format|json_schema|400/i.test(error.message);
}
