import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../api';
import { Status, Tag as TagEntity } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { Auth } from '../../auth';
import { AnonymousTags } from '../../providers/anonymous/anonymous-tags';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import { AnonymousProviderRef } from '../../providers/anonymous/anonymous-mastodon-provider';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-tag',
  imports: [StatusCard],
  templateUrl: './tag.html',
  styleUrl: './tag.css',
})
export class Tag implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  protected auth = inject(Auth);
  private anonymousTags = inject(AnonymousTags);
  private anonymous = inject(AnonymousAccount);
  private anonymousPublic = inject(AnonymousPublicApi);

  protected tag = signal('');
  protected tagInfo = signal<TagEntity | null>(null);
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected followError = signal<string | null>(null);
  protected loadingMore = signal(false);
  protected exhausted = signal(false);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const tag = params.get('tag');
      if (tag) {
        this.tag.set(tag);
        this.load(tag);
      }
    });
  }

  load(tag: string): void {
    this.loading.set(true);
    this.statuses.set([]);
    this.exhausted.set(false);
    this.getTag(tag).subscribe({
      next: (info) =>
        this.tagInfo.set({
          ...info,
          following: this.auth.isAnonymous ? this.anonymousTags.has(info.name) : info.following,
        }),
      error: () => {
        if (this.auth.isAnonymous) {
          this.tagInfo.set({
            id: tag,
            name: tag,
            url: '',
            history: [],
            following: this.anonymousTags.has(tag),
            featuring: false,
          });
        }
      },
    });
    this.getTimeline(tag).subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.exhausted.set(s.length < 20);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore(): void {
    const last = this.statuses().at(-1);
    if (!last || this.loadingMore() || this.exhausted()) return;
    this.loadingMore.set(true);
    this.getTimeline(this.tag(), this.nativeStatusId(last)).subscribe({
      next: (statuses) => {
        const seen = new Set(this.statuses().map((status) => status.id));
        this.statuses.update((current) => [
          ...current,
          ...statuses.filter((status) => !seen.has(status.id)),
        ]);
        this.exhausted.set(statuses.length < 20);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private getTag(name: string): Observable<TagEntity> {
    return this.auth.isAnonymous
      ? this.anonymousPublic.getTag(this.anonymous.server(), name)
      : this.api.getTag(name);
  }

  private getTimeline(name: string, maxId?: string): Observable<Status[]> {
    return this.auth.isAnonymous
      ? this.anonymousPublic.getTagTimeline(this.anonymous.server(), name, maxId)
      : this.api.tagTimeline(name, maxId);
  }

  private nativeStatusId(status: Status): string {
    const ref = status.providerRef as Partial<AnonymousProviderRef> | undefined;
    return status.provider === 'anonymous-mastodon' && typeof ref?.statusId === 'string'
      ? ref.statusId
      : status.id;
  }

  toggleFollow(): void {
    const info = this.tagInfo();
    if (!info) {
      return;
    }
    this.followError.set(null);
    if (this.auth.isAnonymous) {
      if (info.following) {
        this.anonymousTags.unfollow(info.name);
        this.tagInfo.set({ ...info, following: false });
        return;
      }
      const result = this.anonymousTags.follow(info.name);
      if (!result.ok) {
        this.followError.set(result.error);
        return;
      }
      this.tagInfo.set({ ...info, following: true });
      return;
    }
    const call = info.following ? this.api.unfollowTag(info.name) : this.api.followTag(info.name);
    call.subscribe((updated) => this.tagInfo.set(updated));
  }

  toggleFeature(): void {
    const info = this.tagInfo();
    if (!info) {
      return;
    }
    const call = info.featuring ? this.api.unfeatureTag(info.name) : this.api.featureTag(info.name);
    call.subscribe((updated) => this.tagInfo.set(updated));
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
