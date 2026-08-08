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
import { LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FocusTrap } from '../../a11y/focus-trap';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { ClientPrefs } from '../../client-prefs';
import { FeatureFlags } from '../../feature-flags';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import { BloggerSession } from '../../providers/blogger/blogger-session';
import { HugoSettings } from '../../providers/hugo/hugo-settings';
import { MataroaSettings } from '../../providers/mataroa/mataroa-settings';
import { Draft, DraftSnapshot, Drafts, draftHasContent } from '../../drafts';
import { HumanTimePipe } from '../../human-time.pipe';
import { MAX_POST_CHARS, PostTarget } from '../../compose/compose';
import { TargetAvailability, targetLabel, usableTargets } from '../../compose/post-targets';
import { applyMinimalMarkdown } from '../../markdown';
import { stripHtml } from '../../sentiment';
import {
  WizardStep,
  activeSteps,
  firstStep,
  forwardLabel,
  nextStep,
  previousStep,
  stepPosition,
  stepTitle,
} from '../../publish-wizard';
import { runQualityChecks } from './quality-checks';
import { WritingZen } from '../../writing-zen';
import { PkmItem, PkmSource } from '../../pkm/pkm-source';
import { PKM_KINDS, PkmKind, pkmLabel, pkmNoun, withPkmTag } from '../../pkm/pkm-tags';
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
  imports: [FocusTrap, FormsModule, HumanTimePipe, LowerCasePipe, RouterLink],
  templateUrl: './write-page.html',
  styleUrl: './write-page.css',
})
export class WritePage implements OnInit, OnDestroy {
  protected sources = inject(DraftSources);
  protected pkm = inject(PkmSource);
  protected workspace = inject(WriteWorkspace);
  protected zen = inject(WritingZen);
  protected auth = inject(Auth);
  private drafts = inject(Drafts);
  protected prefs = inject(ClientPrefs);
  private api = inject(Api);
  private featureFlags = inject(FeatureFlags);
  private bskySession = inject(BlueskySession);
  private mataroa = inject(MataroaSettings);
  private blogger = inject(BloggerSession);
  private hugo = inject(HugoSettings);

  /**
   * What is linked, flagged on and signed in — the same snapshot the composer
   * builds, read by the same rules in `post-targets.ts`. The wizard must never
   * offer a destination the composer would then refuse.
   */
  private availability(): TargetAvailability {
    return {
      anonymous: this.auth.isAnonymous,
      bskyLinked: this.bskySession.linked(),
      mataroaConnected: this.mataroa.connected(),
      bloggerReady: this.blogger.ready(),
      hugoConnected: this.hugo.connected(),
      pastebinEnabled: this.featureFlags.enabled('pastebin'),
      mataroaEnabled: this.featureFlags.enabled('connector-mataroa'),
      bloggerEnabled: this.featureFlags.enabled('connector-blogger'),
      hugoEnabled: this.featureFlags.enabled('connector-hugo'),
    };
  }
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

  /**
   * Which surface the page is showing.
   *
   * The notes list gets a full-width tab as well as the narrow pane because the
   * to-do list is a *feed*: to-dos are meant to be "read this later" and "write
   * about this later", but somebody will absolutely put their shopping list in
   * there. That is not our business — but it does mean the list has a feed's
   * volume, and a 300px rail is not where you triage a feed.
   *
   * Deliberately a tab and not `/pkm`. That route is the front door of the
   * wider PKM epic (workflow, calendar, bookmarks, links), and claiming it now
   * with a thin version would mean either a shape that epic has to live with or
   * a URL that breaks under it.
   */
  protected tab = signal<'write' | 'notes'>('write');

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

  // ----------------------------------------------------------------- the notes
  //
  // The virtuous distraction. A reading surface offers trending tags and people
  // to follow; a writing surface offers the user their own material.

  protected readonly pkmKindList = PKM_KINDS;
  protected readonly pkmNoun = pkmNoun;
  /** Null is the "All" chip. */
  protected pkmFilter = signal<PkmKind | null>(null);
  /** The one-line jot box at the top of the notes pane. */
  protected jotText = signal('');
  protected jotKind = signal<PkmKind>('note');

  protected pkmVisible = computed(() => this.pkm.byKind(this.pkmFilter()));

  /** The chip label, in the user's own configured word. */
  protected pkmChipLabel(kind: PkmKind): string {
    return pkmLabel(kind, this.prefs.pkmVocabulary());
  }

  /** A kind with no configured words is switched off and gets no chip. */
  protected pkmKindEnabled(kind: PkmKind): boolean {
    return this.prefs.pkmVocabulary()[kind].length > 0;
  }

  protected setPkmFilter(kind: PkmKind | null): void {
    this.pkmFilter.set(kind);
  }

  protected pkmCount(kind: PkmKind | null): number {
    return kind ? this.pkm.counts()[kind] : this.pkm.items().length;
  }

  /**
   * Open a note in the editor, under exactly the rule the drafts pane follows:
   * a local one continues in place, a self-post hands over a copy.
   *
   * Routed through the same `guard` and the same editing state rather than a
   * parallel path, so there is one answer to "what happens to my unsaved work".
   */
  protected openNote(item: PkmItem): void {
    this.guard(() => {
      if (item.source.kind === 'local') {
        this.openLocal(item.source.draft);
        return;
      }
      this.body.set(stripHtml(item.source.status.content));
      this.editing.set({
        key: item.key,
        localId: null,
        origin: 'self',
        title: 'Copy of a private note',
        savedAt: null,
      });
      this.dirty.set(false);
      this.focusEditor();
    });
  }

  /**
   * Jot a note without leaving the draft you are writing.
   *
   * Saves a *new* local draft and deliberately touches nothing else — not the
   * body, not `editing()`, not the dirty flag. Writing down a stray thought
   * must not cost you the piece you are in the middle of, and must not trip the
   * unsaved-work guard on the way.
   */
  protected jot(): void {
    const text = this.jotText().trim();
    if (!text) {
      return;
    }
    const kind = this.jotKind();
    const id = this.drafts.save({
      segments: [withPkmTag(text, kind, this.prefs.pkmVocabulary())],
      spoilerText: '',
      sensitive: false,
      visibility: this.prefs.defaultVisibility(),
      poll: null,
      target: 'fedi',
    });
    // A jot is one line. Opening it later under the `---` default would invite
    // a stray dash to split a two-word note into two posts.
    this.workspace.setSplitMode(`local:${id}`, 'demand');
    this.jotText.set('');
    this.flash(`Saved a ${pkmNoun(kind)}.`);
  }

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
    this.pkm.load();
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
    const first = firstStep(this.prefs.wizardSteps());
    if (!first) {
      // Every step switched off. An empty dialog would be worse than none.
      this.handOffToComposer();
      return;
    }
    this.wizardStep.set(first);
  }

  /**
   * Hand the text to the composer, which owns publishing.
   *
   * Deliberately not guarded. The unsaved-work guard exists to stop writing
   * being thrown away, and handing it to the composer is the opposite of
   * throwing it away — the text goes with you. Prompting "you have unsaved
   * writing" on the way to publishing it would be nonsense.
   */
  private handOffToComposer(): void {
    this.drafts.handoff({ ...this.snapshot(), target: this.wizardTarget() });
    this.dirty.set(false);
    this.wizardStep.set(null);
    void this.router.navigate(['/home']);
  }

  // ------------------------------------------------------------ publish wizard

  /** The step showing, or null when the wizard is closed. */
  protected wizardStep = signal<WizardStep | null>(null);
  protected wizardTarget = signal<PostTarget>('fedi');
  /** A datetime-local value, or empty for "now". */
  protected wizardScheduleAt = signal('');
  protected wizardError = signal<string | null>(null);
  protected wizardBusy = signal(false);

  protected readonly stepTitle = stepTitle;
  protected readonly targetLabel = targetLabel;

  protected wizardEnabled = computed(() => this.prefs.wizardSteps());

  protected wizardPosition = computed(() => {
    const step = this.wizardStep();
    return step ? stepPosition(step, this.wizardEnabled()) : 0;
  });

  protected wizardTotal = computed(() => activeSteps(this.wizardEnabled()).length);

  protected wizardForwardLabel = computed(() => {
    const step = this.wizardStep();
    return step ? forwardLabel(step, this.wizardEnabled()) : 'Publish';
  });

  protected wizardCanGoBack = computed(() => {
    const step = this.wizardStep();
    return !!step && previousStep(step, this.wizardEnabled()) !== null;
  });

  /** Targets this session can actually post to, asked of the composer's own rules. */
  protected wizardTargets = computed(() => usableTargets(this.availability()));

  protected qualityFindings = computed(() =>
    runQualityChecks(this.body(), {
      limit: MAX_POST_CHARS,
      segments: this.segments().map((s) => s.text),
      vocab: this.prefs.pkmVocabulary(),
    }),
  );

  /**
   * Each segment as the markup it will become.
   *
   * `applyMinimalMarkdown` operates on a status's *HTML*, so the plain body is
   * escaped and wrapped in paragraphs first — the same shape a server-rendered
   * status arrives in. It returns its input untouched when the text contains
   * nothing markdown-ish, which is the common case and costs nothing.
   */
  protected previewHtml = computed(() =>
    this.segments().map((segment) => applyMinimalMarkdown(toParagraphs(segment.text))),
  );

  protected setWizardTarget(target: PostTarget): void {
    this.wizardTarget.set(target);
  }

  protected setWizardScheduleAt(at: string): void {
    this.wizardScheduleAt.set(at);
  }

  protected wizardBack(): void {
    const step = this.wizardStep();
    if (step) {
      this.wizardError.set(null);
      this.wizardStep.set(previousStep(step, this.wizardEnabled()));
    }
  }

  /** Cancel: back to the editor, nothing published, nothing lost. */
  protected wizardCancel(): void {
    this.wizardStep.set(null);
    this.wizardError.set(null);
    this.wizardBusy.set(false);
  }

  protected wizardForward(): void {
    const step = this.wizardStep();
    if (!step) {
      return;
    }
    const next = nextStep(step, this.wizardEnabled());
    if (next) {
      this.wizardError.set(null);
      this.wizardStep.set(next);
      return;
    }
    this.wizardFinish();
  }

  /**
   * The end of the wizard.
   *
   * A scheduled post is sent from here, because scheduling is a fire-and-forget
   * server call with nothing left to edit. An immediate one is handed to the
   * composer instead — that is where visibility, media, polls and the
   * thoughtful-posting gate live, and re-implementing them here would mean two
   * publish paths drifting apart.
   */
  private wizardFinish(): void {
    const at = this.wizardScheduleAt();
    if (!at) {
      this.handOffToComposer();
      return;
    }
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) {
      this.wizardError.set('That date could not be read. Pick a time, or publish now.');
      return;
    }
    const text = this.segments()
      .map((s) => s.text)
      .join('\n\n');
    this.wizardBusy.set(true);
    this.wizardError.set(null);
    this.api
      .postStatus(text, {
        visibility: this.prefs.defaultVisibility(),
        scheduledAt: when.toISOString(),
      })
      .subscribe({
        next: () => {
          this.wizardBusy.set(false);
          this.wizardStep.set(null);
          this.dirty.set(false);
          this.flash('Scheduled. It is in your drafts under Parked until it publishes.');
          this.sources.load();
        },
        error: () => {
          this.wizardBusy.set(false);
          // Refusal is ordinary error handling — some instances simply decline a
          // date. Nothing was published and the body is untouched.
          this.wizardError.set(
            'That publish time was refused. Try a nearer one — nothing was published.',
          );
        },
      });
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

/**
 * Plain text as escaped paragraph HTML.
 *
 * Escaping first is not optional: the body is whatever the user typed, and it
 * reaches the preview through `[innerHTML]`. Anything that looks like a tag has
 * to arrive as text, or the preview becomes an injection point into the app's
 * own page.
 */
function toParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
