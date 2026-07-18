import { Injectable, Signal, computed, inject } from '@angular/core';
import { ClientPrefs } from './client-prefs';

/** Every user-visible word that swaps when the post noun changes. */
export interface Words {
  post: string;
  posts: string;
  Post: string;
  Posts: string;
  /** Submit button when the composer holds a thread ("Post all" / "Tweet all"). */
  PostAll: string;
  poster: string;
  posted: string;
  boost: string;
  boosts: string;
  Boost: string;
  Boosts: string;
  boosted: string;
  Boosted: string;
  UndoBoost: string;
  BoostedBy: string;
}

const POST_WORDS: Words = {
  post: 'post',
  posts: 'posts',
  Post: 'Post',
  Posts: 'Posts',
  PostAll: 'Post all',
  poster: 'poster',
  posted: 'posted',
  boost: 'boost',
  boosts: 'boosts',
  Boost: 'Boost',
  Boosts: 'Boosts',
  boosted: 'boosted',
  Boosted: 'Boosted',
  UndoBoost: 'Undo boost',
  BoostedBy: 'Boosted by',
};

const TWEET_WORDS: Words = {
  post: 'tweet',
  posts: 'tweets',
  Post: 'Tweet',
  Posts: 'Tweets',
  PostAll: 'Tweet all',
  poster: 'tweeter',
  posted: 'tweeted',
  boost: 'retweet',
  boosts: 'retweets',
  Boost: 'Retweet',
  Boosts: 'Retweets',
  boosted: 'retweeted',
  Boosted: 'Retweeted',
  UndoBoost: 'Undo retweet',
  BoostedBy: 'Retweeted by',
};

/**
 * Post/boost vocabulary, switchable to tweet/retweet from Settings → Mockingbird
 * Blue (next to stars vs hearts). Purely a client-side label swap — the English
 * UI strings only; server content is untouched.
 */
@Injectable({ providedIn: 'root' })
export class Terminology {
  private prefs = inject(ClientPrefs);

  readonly words: Signal<Words> = computed(() =>
    this.prefs.postNoun() === 'tweet' ? TWEET_WORDS : POST_WORDS,
  );
}
