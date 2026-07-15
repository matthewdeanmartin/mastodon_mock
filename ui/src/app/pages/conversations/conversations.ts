import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Compose } from '../../compose/compose';
import { HumanTimePipe } from '../../human-time.pipe';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { Streaming } from '../../streaming';
import { Account, Conversation, MastodonNotification, Status } from '../../models';

/** localStorage map of chat key → ISO timestamp of the newest message seen there. */
const READ_KEY = 'mockingbird_chat_read';

/**
 * One row in the chat list. Private chats wrap a Mastodon conversation; public
 * chats are synthesized client-side from mention notifications, grouped by
 * participant set (so all threads with the same people read as one IM history).
 */
export interface Chat {
  key: string;
  kind: 'private' | 'public';
  /** The conversation id (private chats only; used for mark-read). */
  convId: string | null;
  /** Participants we hold full Account records for (avatars, moderation menu). */
  accounts: Account[];
  /** Every other participant's handle, including mention-only ones. */
  handles: string[];
  lastStatus: Status | null;
  unread: boolean;
}

function readMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

@Component({
  selector: 'app-conversations',
  imports: [Compose, HumanTimePipe, ReportDialog, RouterLink],
  templateUrl: './conversations.html',
  styleUrl: './conversations.css',
})
export class Conversations implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private streaming = inject(Streaming);

  protected loading = signal(true);
  protected privateConvs = signal<Conversation[]>([]);
  /** Statuses known per public chat key (from notifications + streaming). */
  private publicStatuses = signal<Map<string, Status[]>>(new Map());
  /** Full accounts observed per public chat key. */
  private publicAccounts = signal<Map<string, Account[]>>(new Map());

  protected selectedKey = signal<string | null>(null);
  protected messages = signal<Status[]>([]);
  protected threadLoading = signal(false);
  protected reportTarget = signal<Account | null>(null);
  /** Accounts moderated from the header menu this session, id → 'muted' | 'blocked'. */
  protected moderated = signal<Record<string, string>>({});

  private lastRead = signal<Record<string, string>>(readMap());
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private subs: Subscription[] = [];

  /** Private + public rows merged, newest activity first. */
  protected chats = computed<Chat[]>(() => {
    const me = this.auth.account();
    const rows: Chat[] = this.privateConvs().map((c) => ({
      key: `priv:${c.id}`,
      kind: 'private' as const,
      convId: c.id,
      accounts: c.accounts,
      handles: c.accounts.map((a) => a.acct),
      lastStatus: c.last_status,
      unread: c.unread,
    }));
    const read = this.lastRead();
    for (const [key, statuses] of this.publicStatuses()) {
      const last = statuses[statuses.length - 1] ?? null;
      rows.push({
        key,
        kind: 'public',
        convId: null,
        accounts: this.publicAccounts().get(key) ?? [],
        handles: key.slice('pub:'.length).split(','),
        lastStatus: last,
        unread:
          !!last &&
          last.account.id !== me?.id &&
          (!read[key] || last.created_at > read[key]),
      });
    }
    return rows.sort((a, b) =>
      (b.lastStatus?.created_at ?? '').localeCompare(a.lastStatus?.created_at ?? ''),
    );
  });

  protected selected = computed(
    () => this.chats().find((c) => c.key === this.selectedKey()) ?? null,
  );

  /** Pre-seed the composer with @mentions of the other participants. */
  protected replyMentions = computed(() => {
    const chat = this.selected();
    if (!chat?.handles.length) {
      return '';
    }
    return chat.handles.map((h) => `@${h}`).join(' ') + ' ';
  });

  /** Replies chain onto the newest message in the open thread. */
  protected replyToId = computed(
    () => this.messages().at(-1)?.id ?? this.selected()?.lastStatus?.id,
  );

  /** Public replies keep the thread's visibility; private stays direct. */
  protected replyVisibility = computed(() => {
    const chat = this.selected();
    if (!chat || chat.kind === 'private') {
      return 'direct';
    }
    const vis = this.messages().at(-1)?.visibility ?? chat.lastStatus?.visibility;
    return vis && vis !== 'direct' ? vis : 'public';
  });

  ngOnInit(): void {
    this.load();
    // The IM feel: streams are live while this page is open, closed on leave.
    this.subs.push(
      this.streaming.open({ stream: 'direct' }).subscribe(({ event, payload }) => {
        if (event === 'conversation') {
          this.upsertConversation(payload as Conversation);
        }
      }),
      this.streaming.open({ stream: 'user' }).subscribe(({ event, payload }) => {
        if (event === 'notification') {
          const n = payload as MastodonNotification;
          if (n.type === 'mention' && n.status) {
            this.addPublicStatus(n.status, n.account);
          }
        } else if (event === 'update' || event === 'status_update') {
          this.maybeAppendToThread(payload as Status);
        } else if (event === 'delete') {
          this.messages.update((list) => list.filter((m) => m.id !== payload));
        }
      }),
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }

  load(): void {
    this.loading.set(true);
    let pending = 2;
    const done = () => {
      if (--pending === 0) {
        this.loading.set(false);
      }
    };
    this.api.conversations().subscribe({
      next: (convs) => {
        this.privateConvs.set(convs);
        done();
      },
      error: done,
    });
    this.api.notifications().subscribe({
      next: (notifs) => {
        for (const n of notifs) {
          if (n.type === 'mention' && n.status) {
            this.addPublicStatus(n.status, n.account);
          }
        }
        done();
      },
      error: done,
    });
  }

  select(chat: Chat): void {
    this.selectedKey.set(chat.key);
    this.markRead(chat);
    this.loadThread(chat);
  }

  title(chat: Chat): string {
    if (!chat.accounts.length && !chat.handles.length) {
      // A self-conversation (direct message to yourself).
      return this.auth.account()?.display_name || 'You';
    }
    const named = chat.accounts.map((a) => a.display_name || a.username);
    const known = new Set(chat.accounts.map((a) => a.acct));
    const unnamed = chat.handles.filter((h) => !known.has(h)).map((h) => `@${h}`);
    return [...named, ...unnamed].join(', ');
  }

  protected isMine(m: Status): boolean {
    return m.account.id === this.auth.account()?.id;
  }

  // ---------------------------------------------------------------- thread

  private loadThread(chat: Chat): void {
    const anchor = chat.lastStatus;
    const known = chat.kind === 'public' ? (this.publicStatuses().get(chat.key) ?? []) : [];
    if (!anchor) {
      this.messages.set([]);
      return;
    }
    this.threadLoading.set(true);
    this.messages.set(known.length ? known : [anchor]);
    this.api.getContext(anchor.id).subscribe({
      next: (ctx) => {
        this.messages.set(
          dedupeSort([...ctx.ancestors, anchor, ...ctx.descendants, ...known]),
        );
        this.threadLoading.set(false);
        this.scrollToBottom();
      },
      error: () => this.threadLoading.set(false),
    });
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  onReplyPosted(status: Status): void {
    const chat = this.selected();
    this.messages.update((list) => dedupeSort([...list, status]));
    this.scrollToBottom();
    if (!chat || chat.kind === 'private') {
      // A new direct status starts (or advances) a conversation; refresh the list
      // and follow the selection onto the (possibly new) conversation row.
      this.api.conversations().subscribe((convs) => {
        this.privateConvs.set(convs);
        const mine = convs.find((c) => c.last_status?.id === status.id);
        if (mine && chat?.convId !== mine.id) {
          this.selectedKey.set(`priv:${mine.id}`);
        }
      });
    } else {
      this.addPublicStatus(status, status.account);
    }
  }

  // ---------------------------------------------------------------- read state

  private markRead(chat: Chat): void {
    if (chat.kind === 'private') {
      if (chat.unread && chat.convId) {
        this.api.markConversationRead(chat.convId).subscribe(() => {
          this.privateConvs.update((list) =>
            list.map((c) => (c.id === chat.convId ? { ...c, unread: false } : c)),
          );
        });
      }
      return;
    }
    // Public chats have no server-side read state; remember locally.
    const stamp = chat.lastStatus?.created_at ?? new Date().toISOString();
    this.lastRead.update((map) => {
      const next = { ...map, [chat.key]: stamp };
      localStorage.setItem(READ_KEY, JSON.stringify(next));
      return next;
    });
  }

  // ---------------------------------------------------------------- streaming

  private upsertConversation(conv: Conversation): void {
    this.privateConvs.update((list) => {
      const rest = list.filter((c) => c.id !== conv.id);
      return [conv, ...rest];
    });
    const chat = this.selected();
    if (chat?.kind === 'private' && chat.convId === conv.id && conv.last_status) {
      this.messages.update((list) => dedupeSort([...list, conv.last_status!]));
      this.scrollToBottom();
      this.markRead({ ...chat, unread: true, lastStatus: conv.last_status });
    }
  }

  private addPublicStatus(status: Status, author: Account): void {
    if (status.visibility === 'direct') {
      return; // direct mentions belong to the conversations API, not public chats
    }
    const key = this.publicKey(status);
    this.publicStatuses.update((map) => {
      const next = new Map(map);
      next.set(key, dedupeSort([...(next.get(key) ?? []), status]));
      return next;
    });
    const me = this.auth.account();
    if (author.id !== me?.id) {
      this.publicAccounts.update((map) => {
        const list = map.get(key) ?? [];
        if (list.some((a) => a.id === author.id)) {
          return map;
        }
        const next = new Map(map);
        next.set(key, [...list, author]);
        return next;
      });
    }
    const chat = this.selected();
    if (chat?.key === key) {
      this.messages.update((list) => dedupeSort([...list, status]));
      this.scrollToBottom();
      this.markRead({ ...chat, lastStatus: status });
    }
  }

  private maybeAppendToThread(status: Status): void {
    const chat = this.selected();
    if (!chat) {
      return;
    }
    const inThread =
      !!status.in_reply_to_id && this.messages().some((m) => m.id === status.in_reply_to_id);
    const isEdit = this.messages().some((m) => m.id === status.id);
    if (!inThread && !isEdit) {
      return;
    }
    this.messages.update((list) =>
      isEdit ? list.map((m) => (m.id === status.id ? status : m)) : dedupeSort([...list, status]),
    );
    this.scrollToBottom();
  }

  /** Chat key for a public status: the sorted set of everyone else in it. */
  private publicKey(status: Status): string {
    const me = this.auth.account();
    const handles = new Set<string>();
    if (status.account.acct !== me?.acct) {
      handles.add(status.account.acct);
    }
    for (const m of status.mentions ?? []) {
      if (m.acct !== me?.acct) {
        handles.add(m.acct);
      }
    }
    return 'pub:' + [...handles].sort().join(',');
  }

  // ---------------------------------------------------------------- bubble actions

  toggleFave(m: Status): void {
    const call = m.favourited ? this.api.unfavourite(m.id) : this.api.favourite(m.id);
    call.subscribe((updated) => this.replaceMessage(updated));
  }

  toggleBookmark(m: Status): void {
    const call = m.bookmarked ? this.api.unbookmark(m.id) : this.api.bookmark(m.id);
    call.subscribe((updated) => this.replaceMessage(updated));
  }

  toggleBoost(m: Status): void {
    const call = m.reblogged ? this.api.unreblog(m.id) : this.api.reblog(m.id);
    call.subscribe((updated) => this.replaceMessage(updated.reblog ?? updated));
  }

  private replaceMessage(updated: Status): void {
    this.messages.update((list) => list.map((m) => (m.id === updated.id ? updated : m)));
  }

  // ---------------------------------------------------------------- moderation

  muteParticipant(acc: Account): void {
    this.api.muteAccount(acc.id).subscribe(() => {
      this.moderated.update((m) => ({ ...m, [acc.id]: 'muted' }));
    });
  }

  blockParticipant(acc: Account): void {
    this.api.block(acc.id).subscribe(() => {
      this.moderated.update((m) => ({ ...m, [acc.id]: 'blocked' }));
    });
  }
}

function dedupeSort(statuses: Status[]): Status[] {
  const byId = new Map<string, Status>();
  for (const s of statuses) {
    byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
