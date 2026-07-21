import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HumanTimePipe } from '../human-time.pipe';
import { ElizaService } from './eliza.service';
import { LocalNotificationStore } from './local-notification-store';

/**
 * Eliza's inbox — a browser-local notifications list, the anonymous-friendly
 * counterpart to the real (API-backed, guarded) notifications page. Lists her
 * replies to your posts, her DMs, and the one-time welcome. Opening the page
 * marks everything read, clearing the nav badge. Follow-gated: non-followers are
 * sent to her profile.
 */
@Component({
  selector: 'app-eliza-inbox',
  imports: [RouterLink, HumanTimePipe],
  templateUrl: './eliza-inbox.html',
  styleUrl: './eliza-inbox.css',
})
export class ElizaInbox implements OnInit {
  protected eliza = inject(ElizaService);
  protected store = inject(LocalNotificationStore);
  private router = inject(Router);

  protected account = this.eliza.account();

  ngOnInit(): void {
    if (!this.eliza.following()) {
      void this.router.navigateByUrl('/eliza');
      return;
    }
    this.store.refresh();
    // Reading the inbox clears the unread badge.
    this.store.markAllRead();
  }

  /** Emoji marker per notification kind. */
  icon(kind: string): string {
    switch (kind) {
      case 'message':
        return '💬';
      case 'reply':
        return '↩️';
      case 'welcome':
        return '👋';
      default:
        return '🐦';
    }
  }
}
