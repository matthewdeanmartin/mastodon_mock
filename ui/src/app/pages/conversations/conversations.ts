import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Compose } from '../../compose/compose';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Conversation, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-conversations',
  imports: [Compose, StatusCard],
  templateUrl: './conversations.html',
  styleUrl: './conversations.css',
})
export class Conversations implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);

  protected conversations = signal<Conversation[]>([]);
  protected loading = signal(true);
  protected selectedId = signal<string | null>(null);

  protected selected = computed(
    () => this.conversations().find((c) => c.id === this.selectedId()) ?? null,
  );

  /** Pre-seed a direct reply with @mentions of the other participants. */
  protected replyMentions = computed(() => {
    const conv = this.selected();
    if (!conv) {
      return '';
    }
    const mentions = conv.accounts.map((a) => `@${a.acct}`).join(' ');
    return mentions ? `${mentions} ` : '';
  });

  protected replyToId = computed(() => this.selected()?.last_status?.id);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.conversations().subscribe({
      next: (convs) => {
        this.conversations.set(convs);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  select(conv: Conversation): void {
    this.selectedId.set(conv.id);
    if (conv.unread) {
      this.markRead(conv);
    }
  }

  markRead(conv: Conversation): void {
    this.api.markConversationRead(conv.id).subscribe(() => {
      this.conversations.update((list) =>
        list.map((c) => (c.id === conv.id ? { ...c, unread: false } : c)),
      );
    });
  }

  title(conv: Conversation): string {
    if (!conv.accounts.length) {
      // A self-conversation (direct message to yourself).
      return this.auth.account()?.display_name || 'You';
    }
    return conv.accounts.map((a) => a.display_name || a.username).join(', ');
  }

  onReplyPosted(status: Status): void {
    // A new direct status starts (or advances) a conversation; refresh the list.
    this.load();
    // Optimistically show the new message at the top of the open thread.
    this.selectedId.set(status.id);
  }
}
