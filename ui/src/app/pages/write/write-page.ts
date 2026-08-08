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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FocusTrap } from '../../a11y/focus-trap';
import { Auth } from '../../auth';
import { ClientPrefs } from '../../client-prefs';
import { Draft, DraftSnapshot, Drafts, draftHasContent } from '../../drafts';
import { HumanTimePipe } from '../../human-time.pipe';
import { MAX_POST_CHARS } from '../../compose/compose';
import { WritingZen } from '../../writing-zen';
import { DraftItem, DraftKind, toSnapshot } from '../drafts/draft-items';
import { DraftSources } from '../drafts/draft-sources';
import {
  SPLIT_MODES,
  SplitMode,
  insertSplitAt,
  segmentsFor,
  splitModeHint,
  splitModeLabel,
  splitText,
} from './split-modes';
import { WriteWorkspace } from './write-workspace';

type DraftFilter = 'all' | DraftKind;

interface FilterChip {
  id: DraftFilter;
  label: string;
}

/**
 * What the editor is currently holding.
 *
 * `key` is the workspace-sidecar key, which exists for every kind. `localId` is
 * set only when the editor can save *back* to something — that is true for a
 * local draft, and becomes true for any other kind the moment its copy is saved.
 * Everything else is a copy in progress with no home yet, which is exactly the
 * rule /drafts already follows: a local draft is continued in place, and every
 * other kind hands over a copy while the original stays where it is.
 */
interface Editing {
  key: string;
  localId: string | null;
  /** The kind this text came from, for the "copied from" line. */
  origin: DraftKind | null;
  title: string;
  savedAt: string | null;
}

/** A pending navigation held up by unsaved work. */
interface PendingSwitch {
  run: () => void;
}

/**
 * The writing workspace.
 *
 * Mockingbird's reading surfaces are deliberately distracting, and that is the
 * deal: while you read, the rails offer trending tags and people to follow.
 * A writing surface owes you the opposite kind of distraction — your own drafts,
 * your own notes, the split preview of the thread you are about to post. Same
 * architecture, inverted content.
 *
 * So `/write` goes rails-off wide (like /search and /settings) and spends the
 * width on three panes: drafts, the editor, and notes. And when even those are
 * too much, writing zen turns off everything — see {@link WritingZen} for why
 * that is a different feature from the global zen preference.
 */
@Component({
  selector: 'app-write-page',
  imports: [FocusTrap, FormsModule, HumanTimePipe, RouterLink],
  templateUrl: './write-page.html',
  styleUrl: './write-page.css',
})
export class WritePage implements OnInit, OnDestroy {
  protected sources = inject(DraftSources);
  protected workspace = inject(WriteWorkspace);
  protected zen = inject(WritingZen);
  protected auth = inject(Auth);
  private drafts = inject(Drafts);
  private prefs = inject(ClientPrefs);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private readonly editorBox = viewChild<ElementRef<HTMLTextAreaElement>>('editorBox');
  private readonly zenButton = viewChild<ElementRef<HTMLButtonElement>>('zenButton');

  /** The editor body. One textarea; segmentation is computed, never typed into. */
  protected body = signal('');
  protected editing = signal<Editing | null>(null);
  /** True once the body differs from what was last saved. */
  protected dirty = signal(false);
  protected notice = signal<string | null>(null);
  protected saveError = signal<string | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  protected filter = signal<DraftFilter>('all');
  /** Whether the side panes are open on a narrow screen. */
  protected leftOpen = signal(false);
  protected rightOpen = signal(false);

  /** A switch held up by unsaved work, released or discarded by the dialog. */
  protected pendingSwitch = signal<PendingSwitch | null>(null);

  protected readonly chips: FilterChip[] = [
    { id: 'all', label: 'All' },
    { id: 'local', label: '💾 Local' },
    { id: 'scheduled', label: '⏳ Parked' },
    { id: 'self', label: '🔒 Self' },
    { id: 'paste', label: '📋 Paste' },
  ];

  protected readonly splitModes = SPLIT_MODES;
  protected readonly modeLabel = splitModeLabel;
  protected readonly modeHint = splitModeHint;

  protected visible = computed(() => {
    const filter = this.filter();
    const items = this.sources.items();
    return filter === 'all' ? items : items.filter((item) => item.kind === filter);
  });

  /** The split mode for whatever is open, defaulting for an unsaved new draft. */
  protected splitMode = computed<SplitMode>(() => {
    const current = this.editing();
    return current ? this.workspace.splitMode(current.key) : 'rule';
  });

  /** The live segment preview beside the editor — the first virtuous distraction. */
  protected segments = computed(() =>
    segmentsFor(this.body(), this.splitMode(), { limit: MAX_POST_CHARS }),
  );

  protected overLimitCount = computed(() => this.segments().filter((s) => s.overLimit).length);

  protected hasContent = computed(() => this.body().trim() !== '');

  constructor() {
    // Prune sidecar entries for drafts that are gone. Runs off the live list
    // rather than on a timer: nothing else can tell the workspace a draft was
    // deleted, and the sources signal is the only thing that knows.
    effect(() => {
      if (this.sources.loaded()) {
        this.workspace.prune(this.sources.items().map((item) => item.key));
      }
    });
  }

  ngOnInit(): void {
    this.sources.load();
    const draftId = this.route.snapshot.queryParamMap.get('draft');
    if (draftId) {
      const draft = this.drafts.get(draftId);
      if (draft) {
        this.openLocal(draft);
      }
    }
  }

  ngOnDestroy(): void {
    // A zen session must never leak into another route: the exit control only
    // exists on this page, so leaving while it is on would hide the entire
    // interface with no way back.
    this.zen.exit();
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
  }

  // ------------------------------------------------------------------ editing

  protected onBodyInput(value: string): void {
    this.body.set(value);
    this.dirty.set(true);
  }

  protected count(id: DraftFilter): number {
    return id === 'all' ? this.sources.items().length : this.sources.counts()[id];
  }

  protected select(id: DraftFilter): void {
    this.filter.set(id);
  }

  protected setSplitMode(mode: SplitMode): void {
    const current = this.editing();
    if (current) {
      this.workspace.setSplitMode(current.key, mode);
    }
  }

  /** Insert a boundary at the caret, for split-on-demand. */
  protected splitHere(): void {
    const box = this.editorBox()?.nativeElement;
    if (!box) {
      return;
    }
    const result = insertSplitAt(this.body(), box.selectionStart ?? this.body().length);
    this.body.set(result.text);
    this.dirty.set(true);
    // Restore the caret after Angular writes the new value back into the box.
    setTimeout(() => {
      box.focus();
      box.setSelectionRange(result.caret, result.caret);
    });
  }

  /** Start a fresh draft, guarding whatever is open. */
  protected newDraft(): void {
    this.guard(() => {
      this.body.set('');
      this.editing.set({
        key: `new:${Date.now()}`,
        localId: null,
        origin: null,
        title: 'New draft',
        savedAt: null,
      });
      this.dirty.set(false);
      this.focusEditor();
    });
  }

  /**
   * Load a row into the editor.
   *
   * The rule from the drafts epic holds and is not negotiable: a local draft is
   * continued in place, and every other kind hands over a *copy* while the
   * original stays exactly where it is. Converting must never be how you lose
   * the thing you converted.
   */
  protected open(item: DraftItem): void {
    this.guard(() => {
      if (item.source.kind === 'local') {
        this.openLocal(item.source.draft);
        return;
      }
      const snapshot = toSnapshot(item.source, this.prefs.defaultVisibility());
      this.body.set(joinSegments(snapshot.segments));
      this.editing.set({
        key: item.key,
        localId: null,
        origin: item.kind,
        title: kindTitle(item.kind),
        savedAt: null,
      });
      this.dirty.set(false);
      this.focusEditor();
    });
  }

  private openLocal(draft: Draft): void {
    this.body.set(joinSegments(draft.segments));
    this.editing.set({
      key: `local:${draft.id}`,
      localId: draft.id,
      origin: 'local',
      title: 'Local draft',
      savedAt: draft.updatedAt,
    });
    this.dirty.set(false);
    this.focusEditor();
  }

  /**
   * Save the editor to a local draft.
   *
   * Saving an already-local draft updates it in place rather than appending —
   * a workspace you work in for an hour must not leave forty copies behind. A
   * copy taken from another kind becomes local on its first save, and from then
   * on updates in place too; the source it was copied from is never touched.
   */
  protected save(): void {
    const current = this.editing();
    if (!current || !this.hasContent()) {
      return;
    }
    this.saveError.set(null);
    const snapshot = this.snapshot();
    if (current.localId) {
      if (this.drafts.update(current.localId, snapshot)) {
        this.afterSave(current, current.localId, 'Saved.');
        return;
      }
      // Deleted underneath us — in another tab, or from /drafts. Saving a fresh
      // copy is the only outcome that doesn't throw away what was just written.
      const id = this.drafts.save(snapshot);
      this.afterSave(current, id, 'That draft was gone, so this was saved as a new one.');
      return;
    }
    const id = this.drafts.save(snapshot);
    this.afterSave(
      current,
      id,
      current.origin && current.origin !== 'local'
        ? `Saved as a local draft. The ${kindNoun(current.origin)} is still here too.`
        : 'Saved.',
    );
  }

  private afterSave(current: Editing, localId: string, message: string): void {
    const key = `local:${localId}`;
    // Carry the split mode across, so a copy that has just become a real draft
    // keeps the mode it was written in.
    const mode = this.workspace.splitMode(current.key);
    if (key !== current.key) {
      this.workspace.setSplitMode(key, mode);
    }
    this.editing.set({
      ...current,
      key,
      localId,
      title: 'Local draft',
      savedAt: new Date().toISOString(),
    });
    this.dirty.set(false);
    this.flash(message);
  }

  private snapshot(): DraftSnapshot {
    const segments = splitText(this.body(), this.splitMode(), { limit: MAX_POST_CHARS });
    return {
      segments: segments.length ? segments : [this.body()],
      spoilerText: '',
      sensitive: false,
      visibility: this.prefs.defaultVisibility(),
      poll: null,
      target: 'fedi',
    };
  }

  /**
   * Hand the current text to the composer to publish.
   *
   * Publishing itself is not this sprint's job: the handoff slot and Home's
   * composer already do it, and re-implementing publishing here would mean a
   * second call site to keep in step with visibility, targets and the
   * thoughtful-posting gate.
   */
  protected publish(): void {
    if (!this.hasContent()) {
      return;
    }
    // Deliberately not guarded. The unsaved-work guard exists to stop writing
    // being thrown away, and handing it to the composer is the opposite of
    // throwing it away — the text goes with you. Prompting "you have unsaved
    // writing" on the way to publishing it would be nonsense.
    this.drafts.handoff(this.snapshot());
    this.dirty.set(false);
    void this.router.navigate(['/home']);
  }

  // --------------------------------------------------------- unsaved guarding

  /**
   * Run `action`, unless there is unsaved work — in which case hold it until
   * the user says what to do with it.
   *
   * A workspace that silently eats an edit fails at the one job it has. The
   * composer's autosave slot is a backstop, not a substitute: it holds one
   * body per context, so switching drafts twice would overwrite it.
   */
  private guard(action: () => void): void {
    if (this.dirty() && draftHasContent(this.snapshot())) {
      this.pendingSwitch.set({ run: action });
      return;
    }
    action();
  }

  /** Discard the unsaved body and continue with whatever was held up. */
  protected discardAndContinue(): void {
    const pending = this.pendingSwitch();
    this.pendingSwitch.set(null);
    if (pending) {
      this.dirty.set(false);
      pending.run();
    }
  }

  /** Save the unsaved body first, then continue. */
  protected saveAndContinue(): void {
    const pending = this.pendingSwitch();
    this.pendingSwitch.set(null);
    this.save();
    if (pending) {
      this.dirty.set(false);
      pending.run();
    }
  }

  protected cancelSwitch(): void {
    this.pendingSwitch.set(null);
  }

  // -------------------------------------------------------------- writing zen

  protected enterZen(): void {
    this.zen.enter();
    this.focusEditor();
  }

  /** Leaving zen returns focus to the control that entered it. */
  protected exitZen(): void {
    this.zen.exit();
    setTimeout(() => this.zenButton()?.nativeElement.focus());
  }

  /**
   * Escape leaves zen.
   *
   * A mode that hides the entire interface needs more than one way out, and
   * Escape is the one people try first. The visible exit button is the other —
   * it stays on screen precisely because a mode you cannot see the way out of
   * is a trap.
   */
  protected onZenKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.exitZen();
    }
  }

  protected toggleLeft(): void {
    this.leftOpen.update((v) => !v);
  }

  protected toggleRight(): void {
    this.rightOpen.update((v) => !v);
  }

  private focusEditor(): void {
    setTimeout(() => this.editorBox()?.nativeElement.focus());
  }

  private flash(message: string): void {
    this.notice.set(message);
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    this.noticeTimer = setTimeout(() => this.notice.set(null), 5000);
  }
}

/**
 * A draft's segments as one editable body.
 *
 * Joined with the `---` marker so that reopening a thread shows the boundaries
 * the way they are typed, rather than silently collapsing a three-post thread
 * into one paragraph.
 */
function joinSegments(segments: readonly string[]): string {
  return segments.filter((s) => s.trim() !== '').join('\n\n---\n\n');
}

function kindTitle(kind: DraftKind): string {
  switch (kind) {
    case 'local':
      return 'Local draft';
    case 'scheduled':
      return 'Copy of a parked post';
    case 'self':
      return 'Copy of a private note';
    case 'paste':
      return 'Copy of a paste';
  }
}

function kindNoun(kind: DraftKind): string {
  switch (kind) {
    case 'local':
      return 'original draft';
    case 'scheduled':
      return 'parked post';
    case 'self':
      return 'private note';
    case 'paste':
      return 'paste';
  }
}
