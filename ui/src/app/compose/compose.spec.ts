import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../models';
import { Compose } from './compose';

/** Expose the protected internals for white-box testing. */
interface ComposeInternals {
  text: WritableSignal<string>;
  submitting: WritableSignal<boolean>;
  uploading: WritableSignal<boolean>;
  visibility: WritableSignal<string>;
  cwOpen: WritableSignal<boolean>;
  spoilerText: WritableSignal<string>;
  sensitive: WritableSignal<boolean>;
  media: WritableSignal<{ media: { id: string }; description: string }[]>;
  pollOpen: WritableSignal<boolean>;
  pollOptions: WritableSignal<string[]>;
  pollMultiple: WritableSignal<boolean>;
  pollExpiresIn: WritableSignal<number>;
  canSubmit: Signal<boolean>;
  canAttachMedia: Signal<boolean>;
  canAddPoll: Signal<boolean>;
  toggleCw(): void;
  togglePoll(): void;
  addPollOption(): void;
  removePollOption(index: number): void;
  setPollOption(index: number, value: string): void;
  setMediaDescription(index: number, description: string): void;
  removeMedia(index: number): void;
  submit(): void;
}

function internals(fixture: ComponentFixture<Compose>): ComposeInternals {
  return fixture.componentInstance as unknown as ComposeInternals;
}

describe('Compose', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(): ComponentFixture<Compose> {
    const fixture = TestBed.createComponent(Compose);
    fixture.detectChanges();
    return fixture;
  }

  // ---------------------------------------------------------------- canSubmit

  it('canSubmit is false when text is empty', () => {
    const f = setUp();
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is true when text has non-whitespace content', () => {
    const f = setUp();
    internals(f).text.set('Hello world');
    expect(internals(f).canSubmit()).toBe(true);
  });

  it('canSubmit is false when text is only whitespace', () => {
    const f = setUp();
    internals(f).text.set('   ');
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is false while submitting', () => {
    const f = setUp();
    internals(f).text.set('Hello');
    internals(f).submitting.set(true);
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is false while uploading media', () => {
    const f = setUp();
    internals(f).text.set('Hello');
    internals(f).uploading.set(true);
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is true with an open poll that has at least 2 non-empty options', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    internals(f).pollOptions.set(['Option A', 'Option B']);
    expect(internals(f).canSubmit()).toBe(true);
  });

  it('canSubmit is false with a poll where fewer than 2 options are filled', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    internals(f).pollOptions.set(['Only one', '']);
    expect(internals(f).canSubmit()).toBe(false);
  });

  // ---------------------------------------------------------------- canAttachMedia / canAddPoll

  it('canAttachMedia is true when no poll is open', () => {
    const f = setUp();
    internals(f).pollOpen.set(false);
    expect(internals(f).canAttachMedia()).toBe(true);
  });

  it('canAttachMedia is false when poll is open', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    expect(internals(f).canAttachMedia()).toBe(false);
  });

  it('canAddPoll is true when no media is attached', () => {
    const f = setUp();
    expect(internals(f).canAddPoll()).toBe(true);
  });

  it('canAddPoll is false when media is attached', () => {
    const f = setUp();
    internals(f).media.set([{ media: { id: '1' }, description: '' }]);
    expect(internals(f).canAddPoll()).toBe(false);
  });

  // ---------------------------------------------------------------- toggleCw

  it('toggleCw opens the CW field', () => {
    const f = setUp();
    expect(internals(f).cwOpen()).toBe(false);
    internals(f).toggleCw();
    expect(internals(f).cwOpen()).toBe(true);
  });

  it('toggleCw closes the CW field and clears the spoiler text', () => {
    const f = setUp();
    internals(f).toggleCw();
    internals(f).spoilerText.set('spoiler!');
    internals(f).toggleCw();
    expect(internals(f).cwOpen()).toBe(false);
    expect(internals(f).spoilerText()).toBe('');
  });

  // ---------------------------------------------------------------- togglePoll

  it('togglePoll opens the poll section', () => {
    const f = setUp();
    internals(f).togglePoll();
    expect(internals(f).pollOpen()).toBe(true);
  });

  it('togglePoll closes the poll and resets options', () => {
    const f = setUp();
    internals(f).togglePoll();
    internals(f).pollOptions.set(['A', 'B', 'C']);
    internals(f).pollMultiple.set(true);
    internals(f).togglePoll();
    expect(internals(f).pollOpen()).toBe(false);
    expect(internals(f).pollOptions()).toEqual(['', '']);
    expect(internals(f).pollMultiple()).toBe(false);
  });

  // ---------------------------------------------------------------- poll option management

  it('addPollOption appends an empty option', () => {
    const f = setUp();
    internals(f).addPollOption();
    expect(internals(f).pollOptions()).toEqual(['', '', '']);
  });

  it('addPollOption does nothing when 4 options exist', () => {
    const f = setUp();
    internals(f).pollOptions.set(['A', 'B', 'C', 'D']);
    internals(f).addPollOption();
    expect(internals(f).pollOptions()).toHaveLength(4);
  });

  it('removePollOption removes the option at the given index', () => {
    const f = setUp();
    internals(f).pollOptions.set(['A', 'B', 'C']);
    internals(f).removePollOption(1);
    expect(internals(f).pollOptions()).toEqual(['A', 'C']);
  });

  it('removePollOption does nothing when only 2 options remain', () => {
    const f = setUp();
    // Default starts with ['', ''].
    internals(f).removePollOption(0);
    expect(internals(f).pollOptions()).toEqual(['', '']);
  });

  it('setPollOption updates the value at the correct index', () => {
    const f = setUp();
    internals(f).setPollOption(0, 'Yes');
    internals(f).setPollOption(1, 'No');
    expect(internals(f).pollOptions()).toEqual(['Yes', 'No']);
  });

  // ---------------------------------------------------------------- media management

  it('setMediaDescription updates the description for the correct item', () => {
    const f = setUp();
    internals(f).media.set([
      { media: { id: '1' }, description: '' },
      { media: { id: '2' }, description: '' },
    ]);
    internals(f).setMediaDescription(0, 'A cat');
    expect(internals(f).media()[0].description).toBe('A cat');
    expect(internals(f).media()[1].description).toBe('');
  });

  it('removeMedia removes the attachment at the given index', () => {
    const f = setUp();
    internals(f).media.set([
      { media: { id: '1' }, description: '' },
      { media: { id: '2' }, description: '' },
    ]);
    internals(f).removeMedia(0);
    expect(
      internals(f)
        .media()
        .map((m) => m.media.id),
    ).toEqual(['2']);
  });

  // ---------------------------------------------------------------- submit()

  it('submit() does nothing when canSubmit is false', () => {
    const f = setUp();
    // text is empty, so canSubmit is false
    internals(f).submit();
    httpMock.expectNone('/api/v1/statuses');
  });

  it('submit() POSTs the trimmed text and emits the posted status', () => {
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((s) => posted.push(s));

    internals(f).text.set('  Hello world  ');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.status).toBe('Hello world');

    const stub = { id: '100', content: '<p>Hello world</p>' } as Status;
    req.flush(stub);

    expect(posted).toHaveLength(1);
    expect(posted[0].id).toBe('100');
  });

  it('submit() resets the composer after a successful post', () => {
    const f = setUp();
    internals(f).text.set('Test post');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('cw');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    req.flush({ id: '1' });

    expect(internals(f).text()).toBe('');
    expect(internals(f).cwOpen()).toBe(false);
    expect(internals(f).spoilerText()).toBe('');
    expect(internals(f).submitting()).toBe(false);
  });

  it('submit() clears the submitting flag on HTTP error', () => {
    const f = setUp();
    internals(f).text.set('Test post');
    internals(f).submit();

    httpMock.expectOne('/api/v1/statuses').flush('', { status: 500, statusText: 'Error' });

    expect(internals(f).submitting()).toBe(false);
  });

  it('submit() includes spoiler_text when the CW is open and non-empty', () => {
    const f = setUp();
    internals(f).text.set('Post text');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('Content warning');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.spoiler_text).toBe('Content warning');
    req.flush({ id: '1' });
  });

  it('submit() omits spoiler_text when CW is open but text is whitespace-only', () => {
    const f = setUp();
    internals(f).text.set('Post text');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('   ');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.spoiler_text).toBeUndefined();
    req.flush({ id: '1' });
  });

  it('submit() includes media_ids when media is attached', () => {
    const f = setUp();
    internals(f).text.set('Photo post');
    internals(f).media.set([
      { media: { id: 'media-1' }, description: '' },
      { media: { id: 'media-2' }, description: '' },
    ]);
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.media_ids).toEqual(['media-1', 'media-2']);
    req.flush({ id: '1' });
  });

  it('submit() includes poll params when poll is open and valid', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    internals(f).pollOptions.set(['Yes', 'No']);
    internals(f).pollExpiresIn.set(3600);
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.poll).toEqual({
      options: ['Yes', 'No'],
      expires_in: 3600,
      multiple: false,
    });
    req.flush({ id: '1' });
  });
});
