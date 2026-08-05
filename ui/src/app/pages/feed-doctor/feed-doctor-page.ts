import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account, Status } from '../../models';
import { Auth } from '../../auth';
import { LocalModeration } from '../../local-moderation';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { AnonymousMastodonProvider } from '../../providers/anonymous/anonymous-mastodon-provider';
import { DoctorAction, FeedDiagnosis, Verdict, diagnoseFeed } from '../../feed-doctor';
import { feedSubject } from '../../feed-metrics';
import { sampleFeed } from '../../feed-sample';

/** Posts to diagnose. Enough for shares to mean something, small enough to be quick. */
const SAMPLE_SIZE = 140;

/**
 * Feed Doctor — who is flooding, why the feed ended, whether the sources mix.
 *
 * Diagnostic, not descriptive: `/analytics` already shows the composition of a feed
 * in full. This page answers three specific complaints and puts a button next to
 * each answer. A healthy check collapses to one line, because a page of green
 * checkmarks teaches people to stop reading it.
 *
 * All the judgement lives in `feed-doctor.ts`, which is pure and separately tested.
 * This component only fetches a sample, hands it over, and renders the verdicts.
 */
@Component({
  selector: 'app-feed-doctor-page',
  imports: [RouterLink],
  templateUrl: './feed-doctor-page.html',
  styleUrl: './feed-doctor-page.css',
})
export class FeedDoctorPage implements OnInit {
  private auth = inject(Auth);
  private provider = inject(AnonymousMastodonProvider);
  private follows = inject(AnonymousFollows);
  private moderation = inject(LocalModeration);
  private anonymous = inject(AnonymousAccount);

  protected loading = signal(true);
  protected diagnosis = signal<FeedDiagnosis | null>(null);
  protected collectedAt = signal<Date | null>(null);
  /** Accounts acted on this visit, so the buttons can report what they did. */
  protected acted = signal<Record<string, string>>({});

  protected isAnonymous = computed(() => this.auth.isAnonymous);

  ngOnInit(): void {
    this.run();
  }

  protected run(): void {
    this.loading.set(true);
    this.diagnosis.set(null);
    this.provider.reset();

    // The provider keeps its own cursors and advances them on each call, so `after`
    // is ignored here — `reset()` above is what rewinds it.
    sampleFeed(
      {
        type: 'home',
        query: 'Anonymous home',
        pageSize: 20,
        fetch: () => this.provider.fetchPage(),
      },
      SAMPLE_SIZE,
    ).subscribe({
      next: (sample) => this.report(sample.posts),
      error: () => this.report([]),
    });
  }

  private report(posts: Status[]): void {
    this.diagnosis.set(
      diagnoseFeed({
        posts,
        outcomes: this.provider.lastOutcomes(),
        bySource: this.countSources(posts),
      }),
    );
    this.collectedAt.set(new Date());
    this.loading.set(false);
  }

  /**
   * Group the sample by where it came from.
   *
   * Read off the source labels the provider already records (`@handle`, `#tag`, or a
   * provider name), so this costs nothing and stays correct as sources are added.
   */
  private countSources(posts: Status[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const outcome of this.provider.lastOutcomes()) {
      const label = outcome.handle.startsWith('#')
        ? 'Hashtags'
        : outcome.handle.startsWith('@')
          ? 'Follows'
          : outcome.handle;
      counts[label] = (counts[label] ?? 0) + outcome.fetched;
    }
    // Nothing recorded (a supplied or cached feed): report the sample as one bucket
    // rather than claiming a breakdown we did not measure.
    if (!Object.keys(counts).length && posts.length) {
      counts['Follows'] = posts.length;
    }
    return counts;
  }

  protected verdicts = computed(() => this.diagnosis()?.verdicts ?? []);

  protected sampleSize = computed(() => this.diagnosis()?.sampleSize ?? 0);

  protected icon(verdict: Verdict): string {
    return verdict.severity === 'ok' ? '✓' : '⚠';
  }

  /**
   * Apply an action the user picked.
   *
   * Local moderation, so this works for an anonymous reader — the whole point. The
   * page never acts on its own: every mute and unfollow here is a click.
   */
  protected act(action: DoctorAction): void {
    const account = action.account;
    if (!account) {
      return;
    }
    if (action.kind === 'mute' && action.seconds) {
      this.moderation.mute(account, action.seconds);
      this.note(account, 'Muted for 8 hours.');
      return;
    }
    if (action.kind === 'unfollow') {
      this.follows.unfollow(account, this.anonymous.server());
      this.note(account, 'Unfollowed.');
    }
  }

  private note(account: Account, message: string): void {
    this.acted.set({ ...this.acted(), [account.acct]: message });
  }

  protected actedOn(action: DoctorAction): string | null {
    const acct = action.account?.acct;
    return acct ? (this.acted()[acct] ?? null) : null;
  }

  protected readonly subject = feedSubject;
}
