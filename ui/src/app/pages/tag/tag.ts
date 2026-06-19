import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../api';
import { Status, Tag as TagEntity } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-tag',
  imports: [StatusCard],
  templateUrl: './tag.html',
  styleUrl: './tag.css',
})
export class Tag implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  protected tag = signal('');
  protected tagInfo = signal<TagEntity | null>(null);
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);

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
    this.api.getTag(tag).subscribe((info) => this.tagInfo.set(info));
    this.api.tagTimeline(tag).subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleFollow(): void {
    const info = this.tagInfo();
    if (!info) {
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
