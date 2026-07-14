import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Status } from '../../models';
import { CommandBar } from '../../command-bar/command-bar';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { Announcements } from '../../announcements/announcements';
import { Streaming } from '../../streaming';
import { HomeTimelineFeed } from '../../home-timeline-feed';

/** Below this many follows, nudge toward /find-people (few follows = empty-feeling feed). */
const FOLLOW_NUDGE_THRESHOLD = 5;
const NUDGE_DISMISSED_KEY = 'mockingbird_follow_nudge_dismissed';

@Component({
  selector: 'app-home',
  imports: [CommandBar, Compose, StatusCard, Announcements, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private streaming = inject(Streaming);
  private homeTimelineFeed = inject(HomeTimelineFeed);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected live = signal(false);

  private nudgeDismissed = signal(localStorage.getItem(NUDGE_DISMISSED_KEY) === 'true');

  protected followingCount = computed(() => this.auth.account()?.following_count ?? 0);

  protected showFollowNudge = computed(
    () =>
      !this.nudgeDismissed() &&
      this.auth.account() !== null &&
      this.followingCount() < FOLLOW_NUDGE_THRESHOLD,
  );

  dismissNudge(): void {
    localStorage.setItem(NUDGE_DISMISSED_KEY, 'true');
    this.nudgeDismissed.set(true);
  }

  private liveSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
  }

  toggleLive(): void {
    if (this.live()) {
      this.liveSub?.unsubscribe();
      this.liveSub = null;
      this.live.set(false);
      return;
    }
    this.live.set(true);
    // Going live starts from a fresh snapshot: refetch, then stream deltas on top.
    this.load();
    this.liveSub = this.streaming.open({ stream: 'user' }).subscribe(({ event, payload }) => {
      if (event === 'update') {
        this.statuses.update((list) => [payload as Status, ...list]);
      } else if (event === 'delete') {
        const id = payload as string;
        this.statuses.update((list) => list.filter((s) => s.id !== id));
      }
    });
  }

  load(): void {
    this.loading.set(true);
    this.api.homeTimeline().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.homeTimelineFeed.publish(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore(): void {
    const current = this.statuses();
    const maxId = current.at(-1)?.id;
    if (!maxId) {
      return;
    }
    this.api.homeTimeline(maxId).subscribe((more) => {
      this.statuses.update((s) => [...s, ...more]);
      this.homeTimelineFeed.publish(more);
    });
  }

  onPosted(status: Status): void {
    this.statuses.update((s) => [status, ...s]);
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
