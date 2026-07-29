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
import { Api } from '../../../api';
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
  selectCloneCandidates,
} from '../clone-friends';

type Phase = 'loading' | 'confirm' | 'following' | 'done' | 'error';

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
  private api = inject(Api);
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
      for (let page = 0; page < CLONE_MAX_PAGES; page += 1) {
        const batch = await this.fetchPage(target.id, candidates.at(-1)?.id);
        candidates.push(...batch);
        this.pages.set(page + 1);

        const selection = selectCloneCandidates({
          candidates,
          pagesFetched: page + 1,
          lastPageFull: batch.length >= CLONE_PAGE_SIZE,
          isFollowing: (account) => this.follows.isFollowing(account, this.readServer()),
          remainingSlots: this.remainingSlots(),
          viewerId: this.auth.account()?.id,
        });
        this.selection.set(selection);
        if (!selection.wantsAnotherPage) {
          break;
        }
      }
      this.phase.set('confirm');
    } catch {
      this.error.set(`Couldn't load the accounts ${this.handle()} follows.`);
      this.phase.set('error');
    }
  }

  private fetchPage(id: string, maxId?: string): Promise<Account[]> {
    const ref = this.publicRef();
    // Anonymous reads go out through the public-API service (no token, cross-origin);
    // a signed-in viewer can only reach this dialog in tests, but the branch keeps
    // the component honest rather than assuming.
    return firstValueFrom(
      ref
        ? this.anonymousPublic.getAccountFollowing(ref, maxId)
        : this.api.accountFollowing(id, maxId),
    );
  }

  private readServer(): string {
    return this.publicRef()?.server ?? this.anonymous.server();
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
    const server = this.readServer();
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
