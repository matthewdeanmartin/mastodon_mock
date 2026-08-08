import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Drafts } from '../../drafts';
import { Account, ScheduledStatus, Status } from '../../models';
import { PasteHistory } from '../../providers/paste/paste-history';
import { WritingZen } from '../../writing-zen';
import { DraftItem } from '../drafts/draft-items';
import { DraftSources } from '../drafts/draft-sources';
import { Segment, SplitMode } from './split-modes';
import { WritePage } from './write-page';
import { WriteWorkspace } from './write-workspace';

interface PageInternals {
  body: WritableSignal<string>;
  editing: WritableSignal<{ key: string; localId: string | null } | null>;
  dirty: WritableSignal<boolean>;
  notice: WritableSignal<string | null>;
  pendingSwitch: WritableSignal<{ run: () => void } | null>;
  segments: Signal<Segment[]>;
  splitMode: Signal<SplitMode>;
  sources: DraftSources;
  newDraft(): void;
  open(item: DraftItem): void;
  save(): void;
  publish(): void;
  setSplitMode(mode: SplitMode): void;
  enterZen(): void;
  exitZen(): void;
  onZenKeydown(event: KeyboardEvent): void;
  discardAndContinue(): void;
  saveAndContinue(): void;
  cancelSwitch(): void;
  onBodyInput(value: string): void;
}

function internals(fixture: ComponentFixture<WritePage>): PageInternals {
  return fixture.componentInstance as unknown as PageInternals;
}

const ACCOUNT_ID = 'me-1';
const SCHEDULED_URL = '/api/v1/scheduled_statuses';
const STATUSES_URL = `/api/v1/accounts/${ACCOUNT_ID}/statuses?limit=40`;

function selfStatus(id: string, content: string): Status {
  return {
    id,
    created_at: new Date().toISOString(),
    content: `<p>${content}</p>`,
    spoiler_text: '',
    visibility: 'direct',
    account: { id: ACCOUNT_ID, username: 'me', acct: 'me' } as Account,
    reblog: null,
    mentions: [],
    media_attachments: [],
    poll: null,
  } as unknown as Status;
}

function parked(id: string): ScheduledStatus {
  return {
    id,
    scheduled_at: '2124-01-01T00:00:00Z',
    params: { text: `parked ${id}` },
    media_attachments: [],
  } as unknown as ScheduledStatus;
}

describe('WritePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    // HumanTimePipe is impure and reads the wall clock during change detection;
    // pin time so a second boundary can't move under an assertion.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00Z'));
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'home', children: [] },
          { path: 'drafts', children: [] },
        ]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function signIn(): void {
    const auth = TestBed.inject(Auth);
    auth.mode.set('mastodon');
    auth.account.set({ id: ACCOUNT_ID, username: 'me', acct: 'me' } as Account);
  }

  function setUp(): ComponentFixture<WritePage> {
    const fixture = TestBed.createComponent(WritePage);
    fixture.detectChanges();
    return fixture;
  }

  function saveLocal(segments: string[]): string {
    return TestBed.inject(Drafts).save({
      segments,
      spoilerText: '',
      sensitive: false,
      visibility: 'public',
      poll: null,
    });
  }

  // ------------------------------------------------------------------ loading

  it('issues no requests for an anonymous visitor and still shows local drafts', () => {
    TestBed.inject(Auth).mode.set('anonymous');
    saveLocal(['written while logged out']);
    const page = internals(setUp());

    httpMock.verify();
    expect(page.sources.items().map((i) => i.kind)).toEqual(['local']);
  });

  it('continues a local draft in place — the same draft, not a copy', () => {
    saveLocal(['the original text']);
    const fixture = setUp();
    const page = internals(fixture);

    page.open(page.sources.items()[0]);
    expect(page.body()).toBe('the original text');

    page.onBodyInput('edited text');
    page.save();

    const drafts = TestBed.inject(Drafts);
    expect(drafts.drafts()).toHaveLength(1);
    expect(drafts.drafts()[0].segments).toEqual(['edited text']);
  });

  it('opens a self-post as a copy and leaves the original where it is', () => {
    signIn();
    const fixture = setUp();
    httpMock.expectOne(SCHEDULED_URL).flush([]);
    httpMock.expectOne(STATUSES_URL).flush([selfStatus('s1', 'a private note')]);
    fixture.detectChanges();

    const page = internals(fixture);
    const item = page.sources.items().find((i) => i.kind === 'self')!;
    page.open(item);
    expect(page.body()).toBe('a private note');
    // Nothing saved yet: this is a copy in progress with no home of its own.
    expect(TestBed.inject(Drafts).drafts()).toHaveLength(0);

    page.save();
    // Now it is a local draft — and the self-post is untouched.
    expect(TestBed.inject(Drafts).drafts()).toHaveLength(1);
    expect(page.sources.items().some((i) => i.kind === 'self' && i.id === 's1')).toBe(true);
  });

  it('opens a parked post as a copy and leaves the original parked', () => {
    signIn();
    const fixture = setUp();
    httpMock.expectOne(SCHEDULED_URL).flush([parked('p1')]);
    httpMock.expectOne(STATUSES_URL).flush([]);
    fixture.detectChanges();

    const page = internals(fixture);
    page.open(page.sources.items().find((i) => i.kind === 'scheduled')!);
    page.save();

    expect(page.sources.items().some((i) => i.kind === 'scheduled' && i.id === 'p1')).toBe(true);
  });

  it('opens a paste as a copy and leaves the paste record alone', () => {
    TestBed.inject(Auth).mode.set('anonymous');
    TestBed.inject(PasteHistory).add(
      'rentry',
      'Rentry',
      {
        title: 'pasted',
        content: 'paste body',
        language: 'plaintext',
        expiry: '1w',
        visibility: 'unlisted',
      },
      { slug: 'abc', url: 'u', rawUrl: 'r', editKey: 'k' },
    );
    const page = internals(setUp());

    page.open(page.sources.items().find((i) => i.kind === 'paste')!);
    expect(page.body()).toBe('paste body');
    page.save();

    expect(TestBed.inject(PasteHistory).records()).toHaveLength(1);
  });

  it('reopens a thread with its boundaries visible rather than collapsed', () => {
    saveLocal(['one', 'two', 'three']);
    const page = internals(setUp());

    page.open(page.sources.items()[0]);
    expect(page.body()).toBe('one\n\n---\n\ntwo\n\n---\n\nthree');
    expect(page.segments().map((s) => s.text)).toEqual(['one', 'two', 'three']);
  });

  // ------------------------------------------------------------------- saving

  it('saving twice updates one draft rather than piling up copies', () => {
    const page = internals(setUp());
    page.newDraft();

    page.onBodyInput('first');
    page.save();
    page.onBodyInput('second');
    page.save();

    const drafts = TestBed.inject(Drafts).drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].segments).toEqual(['second']);
  });

  it('saves a fresh copy when the draft was deleted underneath it', () => {
    const id = saveLocal(['held open here']);
    const fixture = setUp();
    const page = internals(fixture);
    page.open(page.sources.items()[0]);

    // Deleted in another tab, or from /drafts.
    TestBed.inject(Drafts).remove(id);
    page.onBodyInput('edited after the delete');
    page.save();

    const drafts = TestBed.inject(Drafts).drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].segments).toEqual(['edited after the delete']);
    expect(page.notice()).toContain('saved as a new one');
  });

  it('splits on --- when saving', () => {
    const page = internals(setUp());
    page.newDraft();
    page.onBodyInput('one\n---\ntwo');
    page.save();

    expect(TestBed.inject(Drafts).drafts()[0].segments).toEqual(['one', 'two']);
  });

  it('saves the whole body as one segment in demand mode', () => {
    const page = internals(setUp());
    page.newDraft();
    page.setSplitMode('demand');
    page.onBodyInput('one\n---\ntwo');
    page.save();

    expect(TestBed.inject(Drafts).drafts()[0].segments).toEqual(['one\n---\ntwo']);
  });

  it('carries the split mode across when a copy becomes a real draft', () => {
    const page = internals(setUp());
    page.newDraft();
    page.setSplitMode('auto');
    page.onBodyInput('some prose');
    page.save();

    const id = TestBed.inject(Drafts).drafts()[0].id;
    expect(TestBed.inject(WriteWorkspace).splitMode(`local:${id}`)).toBe('auto');
  });

  it('does not save an empty body', () => {
    const page = internals(setUp());
    page.newDraft();
    page.onBodyInput('   ');
    page.save();

    expect(TestBed.inject(Drafts).drafts()).toHaveLength(0);
  });

  // ------------------------------------------------------- unsaved-work guard

  it('holds up a switch while there is unsaved writing', () => {
    saveLocal(['a saved draft']);
    const fixture = setUp();
    const page = internals(fixture);

    page.newDraft();
    page.onBodyInput('unsaved work');
    page.open(page.sources.items()[0]);

    // The switch has not happened: the editor still holds the unsaved body.
    expect(page.pendingSwitch()).not.toBeNull();
    expect(page.body()).toBe('unsaved work');
  });

  it('saves and continues, keeping both the old and the new draft', () => {
    saveLocal(['a saved draft']);
    const fixture = setUp();
    const page = internals(fixture);

    page.newDraft();
    page.onBodyInput('unsaved work');
    page.open(page.sources.items().find((i) => i.preview === 'a saved draft')!);
    page.saveAndContinue();

    expect(
      TestBed.inject(Drafts)
        .drafts()
        .map((d) => d.segments[0]),
    ).toContain('unsaved work');
    expect(page.body()).toBe('a saved draft');
  });

  it('discards and continues, keeping nothing', () => {
    saveLocal(['a saved draft']);
    const fixture = setUp();
    const page = internals(fixture);

    page.newDraft();
    page.onBodyInput('unsaved work');
    page.open(page.sources.items()[0]);
    page.discardAndContinue();

    expect(TestBed.inject(Drafts).drafts()).toHaveLength(1);
    expect(page.body()).toBe('a saved draft');
  });

  it('cancelling the guard leaves the unsaved body exactly where it was', () => {
    saveLocal(['a saved draft']);
    const fixture = setUp();
    const page = internals(fixture);

    page.newDraft();
    page.onBodyInput('unsaved work');
    page.open(page.sources.items()[0]);
    page.cancelSwitch();

    expect(page.pendingSwitch()).toBeNull();
    expect(page.body()).toBe('unsaved work');
    expect(page.dirty()).toBe(true);
  });

  it('does not hold up a switch when the saved body is unchanged', () => {
    saveLocal(['a saved draft']);
    const fixture = setUp();
    const page = internals(fixture);

    page.newDraft();
    page.onBodyInput('written and saved');
    page.save();
    page.open(page.sources.items().find((i) => i.preview === 'a saved draft')!);

    expect(page.pendingSwitch()).toBeNull();
    expect(page.body()).toBe('a saved draft');
  });

  // --------------------------------------------------------------------- zen

  it('enters and leaves writing zen', () => {
    const fixture = setUp();
    const page = internals(fixture);
    const zen = TestBed.inject(WritingZen);

    page.enterZen();
    expect(zen.active()).toBe(true);
    page.exitZen();
    expect(zen.active()).toBe(false);
  });

  it('leaves writing zen on Escape', () => {
    const fixture = setUp();
    const page = internals(fixture);
    page.enterZen();

    page.onZenKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(TestBed.inject(WritingZen).active()).toBe(false);
  });

  it('ignores other keys in zen', () => {
    const fixture = setUp();
    const page = internals(fixture);
    page.enterZen();

    page.onZenKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    expect(TestBed.inject(WritingZen).active()).toBe(true);
  });

  it('resets zen when the page is destroyed, so it cannot leak to another route', () => {
    const fixture = setUp();
    internals(fixture).enterZen();

    fixture.destroy();
    expect(TestBed.inject(WritingZen).active()).toBe(false);
  });

  it('shows the editor and the zen box for the same body', () => {
    const fixture = setUp();
    const page = internals(fixture);
    page.newDraft();
    page.onBodyInput('written in the editor');
    fixture.detectChanges();

    // The editor is what's on screen before zen.
    expect(fixture.nativeElement.querySelector('.editor-box')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.zen-box')).toBeNull();

    page.enterZen();
    fixture.detectChanges();

    // In zen there is the text, and nothing else: no panes, no draft list, no
    // notes. Both surfaces read the same body signal, so the text carries over.
    expect(fixture.nativeElement.querySelector('.zen-box')).toBeTruthy();
    expect(page.body()).toBe('written in the editor');
    expect(fixture.nativeElement.querySelector('.panes')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pane-left')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pane-right')).toBeNull();
    // The way out stays visible.
    const labels = [...fixture.nativeElement.querySelectorAll('.zen-bar button')].map(
      (b: Element) => b.textContent?.trim(),
    );
    expect(labels).toContain('Leave zen mode');
  });

  // ---------------------------------------------------------------- publishing

  it('hands the text to the composer rather than posting from here', () => {
    TestBed.inject(Auth).mode.set('anonymous');
    const page = internals(setUp());
    page.newDraft();
    page.onBodyInput('ready to go\n---\nsecond post');
    page.publish();

    const handoff = TestBed.inject(Drafts).takeHandoff();
    expect(handoff?.snapshot.segments).toEqual(['ready to go', 'second post']);
    // Publishing is the composer's job. Asserting the *absence* of a post is
    // the only thing that really proves this page never publishes by itself.
    expect(httpMock.match((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('publishing is not held up by the unsaved-work guard', () => {
    // Handing the text to the composer is the opposite of throwing it away, so
    // prompting "you have unsaved writing" on the way there would be nonsense.
    TestBed.inject(Auth).mode.set('anonymous');
    const page = internals(setUp());
    page.newDraft();
    page.onBodyInput('never saved, straight to publish');
    page.publish();

    expect(page.pendingSwitch()).toBeNull();
    expect(TestBed.inject(Drafts).takeHandoff()?.snapshot.segments).toEqual([
      'never saved, straight to publish',
    ]);
  });

  // ------------------------------------------------------------------ sidecar

  it('prunes sidecar entries for drafts that no longer exist', () => {
    // Anonymous, so the sources settle synchronously and the pruning effect has
    // a loaded list to work from.
    TestBed.inject(Auth).mode.set('anonymous');
    const workspace = TestBed.inject(WriteWorkspace);
    workspace.setSplitMode('local:long-gone', 'auto');
    const id = saveLocal(['still here']);
    workspace.setSplitMode(`local:${id}`, 'demand');

    const fixture = setUp();
    fixture.detectChanges();

    expect(workspace.splitMode('local:long-gone')).toBe('rule');
    // The draft that still exists keeps its mode.
    expect(workspace.splitMode(`local:${id}`)).toBe('demand');
  });

  it('remembers a split mode per draft across reopens', () => {
    saveLocal(['first draft']);
    saveLocal(['second draft']);
    const fixture = setUp();
    const page = internals(fixture);

    const second = page.sources.items().find((i) => i.preview === 'second draft')!;
    page.open(second);
    page.setSplitMode('auto');

    page.open(page.sources.items().find((i) => i.preview === 'first draft')!);
    expect(page.splitMode()).toBe('rule');

    page.open(second);
    expect(page.splitMode()).toBe('auto');
  });
});
