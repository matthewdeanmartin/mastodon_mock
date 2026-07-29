import {
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Account } from '../../../models';
import { Auth } from '../../../auth';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';
import { AnonymousPublicApi } from '../../../providers/anonymous/anonymous-public-api';
import {
  ANONYMOUS_FOLLOW_LIMIT,
  AnonymousFollows,
} from '../../../providers/anonymous/anonymous-follows';
import { AnonymousPublicRef } from '../../../providers/anonymous/anonymous-route-ref';
import {
  CLONE_MAX_PAGES,
  CLONE_PAGE_SIZE,
  CloneSelection,
  describeSelection,
  followsAreHidden,
  homeServerFor,
  selectCloneCandidates,
} from '../clone-friends';

type Phase = 'loading' | 'confirm' | 'following' | 'done' | 'error' | 'hidden';

/**
 * "Clone friends list" — adopt the accounts this profile follows.
 *
 * The dialog owns the whole flow (page, filter, confirm, follow, report) so the
 * profile page only has to open it. That is worth the size: the interesting rules
 * live in `clone-friends.ts` and `follow-quality.ts`, both pure and both tested
 * without any of this.
 *
 * Two things are deliberate and should survive refactoring:
 *
 *  - **Every follow here is a local write.** `AnonymousFollows.follow` puts a row in
 *    localStorage; nothing is sent to anyone's server. That is the only reason
 *    following twenty accounts at once is a safe thing to offer, and it is why the
 *    profile page hides this entry entirely when signed in.
 *  - **The filtering is shown, not hidden.** "Followed 6 of 63" invites "why only
 *    6?", so the answer is on screen before the user commits.
 */
@Component({
  selector: 'app-clone-friends-dialog',
  imports: [RouterLink],
  templateUrl: './clone-friends-dialog.html',
  styleUrl: './clone-friends-dialog.css',
})
export class CloneFriendsDialog implements OnInit {
  private auth = inject(Auth);
  private anonymous = inject(AnonymousAccount);
  private anonymousPublic = inject(AnonymousPublicApi);
  private follows = inject(AnonymousFollows);

  /** The profile whose follows are being cloned. */
  readonly account = input.required<Account>();
  /** Set when the profile was reached as a public (cross-instance) reference. */
  readonly publicRef = input<AnonymousPublicRef | null>(null);

  readonly closed = output<void>();
  /** Emitted after a successful clone, so the profile can refresh its own state. */
  readonly cloned = output<number>();

  protected phase = signal<Phase>('loading');
  protected error = signal<string | null>(null);
  protected selection = signal<CloneSelection | null>(null);
  /** The server the list was read from — named, because which one it was matters. */
  protected sourceHost = signal('');
  /** True when we fell back to a relay's partial view of the follow graph. */
  protected partial = signal(false);
  /** The resolved read source; candidate ids belong to this server's namespace. */
  private source = signal<AnonymousPublicRef | null>(null);
  /** Pages fetched, shown while loading so a three-page walk doesn't look stuck. */
  protected pages = signal(0);
  /** How many have been followed so far, during the `following` phase. */
  protected progress = signal(0);
  protected showSkipped = signal(false);

  protected readonly maxPages = CLONE_MAX_PAGES;
  protected readonly followLimit = ANONYMOUS_FOLLOW_LIMIT;

  protected handle = computed(() => `@${this.account().acct || this.account().username}`);

  protected remainingSlots = computed(() =>
    Math.max(0, ANONYMOUS_FOLLOW_LIMIT - this.follows.count()),
  );

  protected summary = computed(() => {
    const selection = this.selection();
    return selection ? describeSelection(selection, this.handle()) : '';
  });

  /**
   * Load on init, not in the constructor: a required `input()` is not populated
   * until after construction, so reading `account()` there throws NG0950.
   */
  ngOnInit(): void {
    void this.load();
  }

  /**
   * Walk `/following` until there are enough survivors, or the pages run out.
   *
   * Paging is driven by `selectCloneCandidates`: it sees everything fetched so far
   * and says whether another request is worth making. The quality gate is why this
   * is a loop at all — one page of eighty follows often yields fewer than twenty
   * accounts worth a feed call.
   */
  private async load(): Promise<void> {
    const target = this.account();
    const candidates: Account[] = [];
    try {
      const source = await this.resolveSource(target);
      this.source.set(source.ref);
      this.sourceHost.set(source.host);
      this.partial.set(source.partial);

      for (let page = 0; page < CLONE_MAX_PAGES; page += 1) {
        const batch = await this.fetchPage(source.ref, candidates.at(-1)?.id);
        candidates.push(...batch);
        this.pages.set(page + 1);

        const selection = selectCloneCandidates({
          candidates,
          pagesFetched: page + 1,
          lastPageFull: batch.length >= CLONE_PAGE_SIZE,
          isFollowing: (account) => this.follows.isFollowing(account, source.ref.server),
          remainingSlots: this.remainingSlots(),
          viewerId: this.auth.account()?.id,
        });
        this.selection.set(selection);
        if (!selection.wantsAnotherPage) {
          break;
        }
      }

      // An account that advertises follows but hands back an empty list is refusing,
      // not empty. Saying "nothing new to follow" there is simply false.
      if (followsAreHidden(target, candidates.length, this.pages())) {
        this.phase.set('hidden');
        return;
      }
      this.phase.set('confirm');
    } catch {
      this.error.set(`Couldn't load the accounts ${this.handle()} follows.`);
      this.phase.set('error');
    }
  }

  /**
   * Find the server that holds the authoritative follow list, and resolve the
   * account's id *there*.
   *
   * Two calls in the cross-instance case (lookup, then the list), and worth every
   * bit of the second one: read through a relay and you get only the slice of the
   * graph that relay federated, which made the whole feature look broken.
   *
   * If the home server can't be reached — blocked, down, CORS — we fall back to the
   * partial view rather than failing outright, and set {@link partial} so the dialog
   * says the list is incomplete instead of implying it is the truth.
   */
  private async resolveSource(
    target: Account,
  ): Promise<{ ref: AnonymousPublicRef; host: string; partial: boolean }> {
    const current = this.publicRef();
    const currentServer = current?.server ?? this.anonymous.server();
    const home = homeServerFor(target, currentServer);
    const bare = (value: string) => value.replace(/^https?:\/\//, '').toLowerCase();

    // Already reading the account's own server: nothing to resolve.
    if (bare(home) === bare(currentServer) && current) {
      return { ref: current, host: bare(home), partial: false };
    }

    try {
      const canonical = await firstValueFrom(
        this.anonymousPublic.lookupAccount(home, target.username),
      );
      return {
        ref: { server: home, id: canonical.id },
        host: bare(home),
        partial: false,
      };
    } catch {
      if (!current) {
        throw new Error('No readable source for this account.');
      }
      return { ref: current, host: bare(currentServer), partial: true };
    }
  }

  private fetchPage(ref: AnonymousPublicRef, maxId?: string): Promise<Account[]> {
    return firstValueFrom(this.anonymousPublic.getAccountFollowing(ref, maxId));
  }

  /**
   * Adopt them. No network: each follow is a localStorage write, which is what
   * makes doing twenty of them at once reasonable.
   */
  async confirm(): Promise<void> {
    const selection = this.selection();
    if (!selection?.adopt.length || this.phase() === 'following') {
      return;
    }
    this.phase.set('following');
    this.progress.set(0);
    // The server these ids came from, not the browsing server: AnonymousFollows
    // stores it as the read-ref it will later fetch each feed through, and an id
    // from one instance does not resolve on another.
    const server = this.source()?.server ?? this.anonymous.server();
    let followed = 0;
    for (const account of selection.adopt) {
      const result = this.follows.follow(account, server);
      if (!result.ok) {
        // Hitting the cap mid-batch is not an error worth throwing away the rest
        // of the work for — report what landed.
        this.error.set(result.error);
        break;
      }
      followed += 1;
      this.progress.set(followed);
    }
    this.phase.set('done');
    this.cloned.emit(followed);
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }
}
