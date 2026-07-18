import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { ClientPrefs } from '../../client-prefs';
import { Compose } from '../../compose/compose';
import { HumanTimePipe } from '../../human-time.pipe';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { Streaming } from '../../streaming';
import { Account, Conversation, MastodonNotification, Relationship, Status } from '../../models';
import { BlueskyChatApi, isChatScopeError } from '../../providers/bluesky/bluesky-chat-api';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import {
  BskyChatMember,
  BskyConvoView,
  BskyMessageView,
} from '../../providers/bluesky/bluesky-types';

/** localStorage map of chat key → ISO timestamp of the newest message seen there. */
const READ_KEY = 'mockingbird_chat_read';

/**
 * One row in the chat list. Private chats wrap a Mastodon conversation. Public
 * chats are synthesized client-side from mention notifications, grouped by the
 * reply guy (status author): tracing reply graphs to identify "the same thread"
 * is deliberately avoided, so all public mentions from steve read as one IM
 * history with steve, separate from any private chat with him.
 */
export interface Chat {
  key: string;
  kind: 'private' | 'public' | 'bsky';
  /** Ids of the merged conversations (private chats only; used for mark-read). */
  convIds: string[];
  /** Participants we hold full Account records for (avatars, moderation menu). */
  accounts: Account[];
  /** Every other participant's handle, including mention-only ones. */
  handles: string[];
  lastStatus: Status | null;
  unread: boolean;
  /** Bluesky chats only: the convo id and the other participants. */
  convoId?: string;
  members?: BskyChatMember[];
  /** Bluesky chats only: plain-text preview + timestamp (no Status to lean on). */
  previewText?: string;
  lastAt?: string;
}

function readMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Leading `@user` / `@user@domain` runs (with separating spaces/commas). */
const LEADING_MENTIONS = /^(?:[\s,]*@[\w.-]+(?:@[\w.-]+)?)+[\s,:]*/;

/**
 * Drop the `@a @b …` prelude that starts almost every reply, so chat rows and
 * bubbles lead with the actual message. Handles both Mastodon's h-card markup
 * and plain-text mentions. Falls back to the original when nothing but
 * mentions remain (an empty bubble is worse than a noisy one).
 */
export function stripLeadingMentions(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = doc.body.querySelector('p') ?? doc.body;
  let node: ChildNode | null = container.firstChild;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const stripped = (node.textContent ?? '').replace(LEADING_MENTIONS, '');
      if (!stripped.trim()) {
        const next = node.nextSibling;
        node.remove();
        node = next;
        continue;
      }
      node.textContent = stripped.replace(/^\s+/, '');
      break;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains('h-card') || el.classList.contains('mention')) {
        const next = node.nextSibling;
        el.remove();
        node = next;
        continue;
      }
      break;
    }
    node = node.nextSibling;
  }
  const out = doc.body.innerHTML.trim();
  return out && out !== '<p></p>' ? out : html;
}

@Component({
  selector: 'app-conversations',
  imports: [Compose, FormsModule, HumanTimePipe, ReportDialog, RouterLink],
  templateUrl: './conversations.html',
  styleUrl: './conversations.css',
})
export class Conversations implements OnInit, OnDestroy {
  private api = inject(Api);
  private auth = inject(Auth);
  private streaming = inject(Streaming);
  private bskyChat = inject(BlueskyChatApi);
  protected bsky = inject(BlueskySession);
  protected prefs = inject(ClientPrefs);

  protected loading = signal(true);
  protected privateConvs = signal<Conversation[]>([]);
  protected bskyConvos = signal<BskyConvoView[]>([]);
  /** The linked app password can't read DMs; show the relink hint. */
  protected bskyScopeError = signal(false);
  protected bskyMessages = signal<BskyMessageView[]>([]);
  protected bskyDraft = signal('');
  protected bskySending = signal(false);
  private bskyPoll: ReturnType<typeof setInterval> | null = null;
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

  /** Relationships for the mutuals filter; fetched lazily, only when it's on. */
  private rels = signal<Map<string, Relationship>>(new Map());
  private requestedRels = new Set<string>();

  private strippedCache = new Map<string, string>();

  constructor() {
    effect(() => {
      if (this.prefs.chatAudience() !== 'mutuals') {
        return;
      }
      const missing = new Set<string>();
      for (const chat of this.chats()) {
        for (const a of chat.accounts) {
          if (!this.requestedRels.has(a.id)) {
            missing.add(a.id);
          }
        }
      }
      if (!missing.size) {
        return;
      }
      for (const id of missing) {
        this.requestedRels.add(id);
      }
      this.api.relationships([...missing]).subscribe((list) => {
        this.rels.update((map) => {
          const next = new Map(map);
          for (const r of list) {
            next.set(r.id, r);
          }
          return next;
        });
      });
    });
  }

  /** Private + public rows merged, newest activity first. */
  protected chats = computed<Chat[]>(() => {
    const me = this.auth.account();
    // The conversations API returns one row per thread; like public chats we
    // group by the people instead, merging every thread with the same set.
    const byKey = new Map<string, Chat>();
    for (const c of this.privateConvs()) {
      const key = privateKey(c.accounts);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          key,
          kind: 'private',
          convIds: [c.id],
          accounts: c.accounts,
          handles: c.accounts.map((a) => a.acct),
          lastStatus: c.last_status,
          unread: c.unread,
        });
        continue;
      }
      existing.convIds.push(c.id);
      existing.unread = existing.unread || c.unread;
      if (
        c.last_status &&
        (!existing.lastStatus || c.last_status.created_at > existing.lastStatus.created_at)
      ) {
        existing.lastStatus = c.last_status;
      }
    }
    const rows: Chat[] = [...byKey.values()];
    const read = this.lastRead();
    for (const [key, statuses] of this.publicStatuses()) {
      const last = statuses[statuses.length - 1] ?? null;
      rows.push({
        key,
        kind: 'public',
        convIds: [],
        accounts: this.publicAccounts().get(key) ?? [],
        handles: key.slice('pub:'.length).split(','),
        lastStatus: last,
        unread: !!last && last.account.id !== me?.id && (!read[key] || last.created_at > read[key]),
      });
    }
    const myDid = this.bsky.session()?.did;
    for (const convo of this.bskyConvos()) {
      const others = convo.members.filter((m) => m.did !== myDid);
      rows.push({
        key: `bsky:${convo.id}`,
        kind: 'bsky',
        convIds: [],
        accounts: [],
        handles: others.map((m) => m.handle),
        lastStatus: null,
        unread: convo.unreadCount > 0,
        convoId: convo.id,
        members: others,
        previewText: convo.lastMessage?.text ?? '',
        lastAt: convo.lastMessage?.sentAt,
      });
    }
    return rows.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  });

  /** The chat list after the audience (mutuals) and kind (🔒/📢) toggles. */
  protected visibleChats = computed<Chat[]>(() => {
    const kind = this.prefs.chatKind();
    const audience = this.prefs.chatAudience();
    const rels = this.rels();
    return this.chats().filter((c) => {
      if (kind !== 'all' && c.kind !== kind) {
        return false;
      }
      if (audience === 'mutuals' && c.accounts.length) {
        const mutual = c.accounts.every((a) => {
          const r = rels.get(a.id);
          return !!r && r.following && r.followed_by;
        });
        if (!mutual) {
          return false;
        }
      }
      return true;
    });
  });

  protected selected = computed(
    () => this.chats().find((c) => c.key === this.selectedKey()) ?? null,
  );

  /** Pre-seed the composer with @mentions of the other participants. */
  protected replyMentions = computed(() => {
    const chat = this.selected();
    if (!chat) {
      return '';
    }
    const handles = new Set<string>(chat.handles.filter((h) => h !== ''));
    if (chat.kind === 'public') {
      // Author-grouped chats only know the reply guy; keep everyone the last
      // message was addressed to in the thread too.
      const me = this.auth.account();
      const last = this.messages().at(-1) ?? chat.lastStatus;
      if (last) {
        if (last.account.acct !== me?.acct) {
          handles.add(last.account.acct);
        }
        for (const m of last.mentions ?? []) {
          if (m.acct !== me?.acct) {
            handles.add(m.acct);
          }
        }
      }
    }
    return handles.size ? [...handles].map((h) => `@${h}`).join(' ') + ' ' : '';
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
    // Bluesky chat has no client-reachable stream; poll the convo list gently.
    if (this.bsky.linked()) {
      this.bskyPoll = setInterval(() => this.refreshBskyConvos(), 20_000);
    }
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    if (this.bskyPoll) {
      clearInterval(this.bskyPoll);
    }
  }

  load(): void {
    this.loading.set(true);
    let pending = this.bsky.linked() ? 3 : 2;
    const done = () => {
      if (--pending === 0) {
        this.loading.set(false);
      }
    };
    if (this.bsky.linked()) {
      this.bskyChat.listConvos().subscribe({
        next: (list) => {
          this.bskyConvos.set(list.convos);
          this.bskyScopeError.set(false);
          done();
        },
        error: (err: unknown) => {
          this.bskyScopeError.set(isChatScopeError(err));
          done();
        },
      });
    }
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
    if (chat.kind === 'bsky') {
      this.loadBskyThread(chat);
      return;
    }
    this.markRead(chat);
    this.loadThread(chat);
  }

  title(chat: Chat): string {
    if (chat.kind === 'bsky') {
      const named = (chat.members ?? []).map((m) => m.displayName || m.handle);
      return named.join(', ') || 'Bluesky chat';
    }
    if (!chat.accounts.length && !chat.handles.some((h) => h !== '')) {
      // A self-conversation (direct message to yourself).
      return this.auth.account()?.display_name || 'You';
    }
    const named = chat.accounts.map((a) => a.display_name || a.username);
    const known = new Set(chat.accounts.map((a) => a.acct));
    const unnamed = chat.handles.filter((h) => h !== '' && !known.has(h)).map((h) => `@${h}`);
    return [...named, ...unnamed].join(', ');
  }

  protected isMine(m: Status): boolean {
    return m.account.id === this.auth.account()?.id;
  }

  /** Message HTML minus the leading @mention run (memoized; edits re-render). */
  protected stripped(s: Status): string {
    const cacheKey = `${s.id}:${s.edited_at ?? ''}`;
    let out = this.strippedCache.get(cacheKey);
    if (out === undefined) {
      out = stripLeadingMentions(s.content);
      this.strippedCache.set(cacheKey, out);
    }
    return out;
  }

  // ---------------------------------------------------------------- thread

  private loadThread(chat: Chat): void {
    const anchor = chat.lastStatus;
    // Merged private chats span several threads; their last statuses at least
    // belong in the history even though only the anchor's context is fetched.
    const known =
      chat.kind === 'public'
        ? (this.publicStatuses().get(chat.key) ?? [])
        : this.privateConvs()
            .filter((c) => chat.convIds.includes(c.id) && c.last_status)
            .map((c) => c.last_status!);
    if (!anchor) {
      this.messages.set([]);
      return;
    }
    this.threadLoading.set(true);
    this.messages.set(known.length ? known : [anchor]);
    this.api.getContext(anchor.id).subscribe({
      next: (ctx) => {
        this.messages.set(dedupeSort([...ctx.ancestors, anchor, ...ctx.descendants, ...known]));
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
        if (mine) {
          this.selectedKey.set(privateKey(mine.accounts));
        }
      });
    } else {
      // My own reply can't be keyed by author; it belongs to the open chat.
      this.addPublicStatus(status, status.account, chat.key);
    }
  }

  // ---------------------------------------------------------------- bluesky

  protected bskyIsMine(m: BskyMessageView): boolean {
    return m.sender.did === this.bsky.session()?.did;
  }

  /** The sender's profile bits, for avatars/names on their bubbles. */
  protected bskyAuthor(chat: Chat, did: string): BskyChatMember | null {
    return (chat.members ?? []).find((m) => m.did === did) ?? null;
  }

  private loadBskyThread(chat: Chat): void {
    if (!chat.convoId) {
      return;
    }
    this.threadLoading.set(true);
    this.bskyMessages.set([]);
    this.bskyChat.getMessages(chat.convoId).subscribe({
      next: ({ messages }) => {
        // Newest-first from the API; deleted messages arrive without text.
        const chronological = messages.filter((m) => m.text !== undefined).reverse();
        this.bskyMessages.set(chronological);
        this.threadLoading.set(false);
        this.scrollToBottom();
        const newest = chronological.at(-1);
        if (newest) {
          // Best-effort: a failed read-receipt shouldn't surface anywhere.
          this.bskyChat.updateRead(chat.convoId!, newest.id).subscribe({ error: () => undefined });
        }
        this.bskyConvos.update((list) =>
          list.map((c) => (c.id === chat.convoId ? { ...c, unreadCount: 0 } : c)),
        );
      },
      error: () => this.threadLoading.set(false),
    });
  }

  sendBskyMessage(): void {
    const chat = this.selected();
    const text = this.bskyDraft().trim();
    if (!chat?.convoId || !text || this.bskySending()) {
      return;
    }
    this.bskySending.set(true);
    this.bskyChat.sendMessage(chat.convoId, text).subscribe({
      next: (message) => {
        this.bskySending.set(false);
        this.bskyDraft.set('');
        this.bskyMessages.update((list) => [...list, message]);
        this.bskyConvos.update((list) =>
          list.map((c) => (c.id === chat.convoId ? { ...c, lastMessage: message } : c)),
        );
        this.scrollToBottom();
      },
      error: () => this.bskySending.set(false),
    });
  }

  private refreshBskyConvos(): void {
    this.bskyChat.listConvos().subscribe({
      next: (list) => {
        const before = this.bskyConvos();
        this.bskyConvos.set(list.convos);
        const chat = this.selected();
        if (chat?.kind !== 'bsky' || !chat.convoId) {
          return;
        }
        // Reload the open thread only when its convo actually advanced.
        const prev = before.find((c) => c.id === chat.convoId);
        const next = list.convos.find((c) => c.id === chat.convoId);
        if (next && next.rev !== prev?.rev) {
          this.loadBskyThread(chat);
        }
      },
      error: () => undefined, // polling silently tolerates a flaky network
    });
  }

  // ---------------------------------------------------------------- read state

  private markRead(chat: Chat): void {
    if (chat.kind === 'private') {
      const unreadIds = this.privateConvs()
        .filter((c) => chat.convIds.includes(c.id) && c.unread)
        .map((c) => c.id);
      for (const id of unreadIds) {
        this.api.markConversationRead(id).subscribe(() => {
          this.privateConvs.update((list) =>
            list.map((c) => (c.id === id ? { ...c, unread: false } : c)),
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
    if (chat?.kind === 'private' && chat.key === privateKey(conv.accounts) && conv.last_status) {
      this.messages.update((list) => dedupeSort([...list, conv.last_status!]));
      this.scrollToBottom();
      this.markRead({ ...chat, unread: true, lastStatus: conv.last_status });
    }
  }

  private addPublicStatus(status: Status, author: Account, keyOverride?: string): void {
    if (status.visibility === 'direct') {
      return; // direct mentions belong to the conversations API, not public chats
    }
    const key = keyOverride ?? this.publicKey(author);
    if (!key) {
      return;
    }
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

  /**
   * Public chats group by the reply guy: all public mentions authored by the
   * same person read as one IM history, regardless of which thread they came
   * from (no reply-graph tracing). My own statuses have no key of their own —
   * they join whichever chat they were sent from (see onReplyPosted).
   */
  private publicKey(author: Account): string | null {
    return author.id === this.auth.account()?.id ? null : `pub:${author.acct}`;
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

/** Newest-activity stamp for sorting; bsky rows carry it outside lastStatus. */
function lastActivity(c: Chat): string {
  return c.lastStatus?.created_at ?? c.lastAt ?? '';
}

/** Private chats group by participant set (matching how public ones group by author). */
function privateKey(accounts: Account[]): string {
  return (
    'priv:' +
    accounts
      .map((a) => a.acct)
      .sort()
      .join(',')
  );
}

function dedupeSort(statuses: Status[]): Status[] {
  const byId = new Map<string, Status>();
  for (const s of statuses) {
    byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
