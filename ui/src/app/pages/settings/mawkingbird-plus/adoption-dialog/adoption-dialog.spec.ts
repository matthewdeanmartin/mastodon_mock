import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdoptionDialog } from './adoption-dialog';
import type { AdoptionChoice } from '../../../../providers/account/collection-adoption';

describe('AdoptionDialog', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<AdoptionDialog>>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(AdoptionDialog);
    fixture.componentRef.setInput('collection', 'trust');
    fixture.componentRef.setInput('localCount', 3);
    fixture.componentRef.setInput('remoteCount', 5);
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function button(label: string): HTMLButtonElement {
    const match = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!match) {
      throw new Error(`no "${label}" button`);
    }
    return match;
  }

  it('says how much is on each side', () => {
    expect(text()).toContain('3');
    expect(text()).toContain('5');
    expect(text()).toContain('trusted accounts');
  });

  it('names the collection it is asking about', () => {
    fixture.componentRef.setInput('collection', 'feeds');
    fixture.detectChanges();

    expect(text()).toContain('feed subscriptions');
  });

  it('offers merge and replace, and no third answer', () => {
    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .map((candidate) => candidate.textContent?.trim())
      .filter((label) => label && label !== 'Cancel');

    // Keep both, use the account's, not now — and nothing that would overwrite
    // the account with this browser's copy.
    expect(labels).toEqual(['Keep both', "Use my account's", 'Not now']);
  });

  it('says out loud that overwriting the account is not offered', () => {
    // Someone looking for that option should find out here that it does not
    // exist, rather than hunting for it.
    expect(text()).toContain("There's no option to overwrite your account");
  });

  it('emits the chosen answer', () => {
    const chosen: AdoptionChoice[] = [];
    fixture.componentInstance.chose.subscribe((choice) => chosen.push(choice));

    button('Keep both').click();

    expect(chosen).toEqual(['merge']);
  });

  it('emits replace', () => {
    const chosen: AdoptionChoice[] = [];
    fixture.componentInstance.chose.subscribe((choice) => chosen.push(choice));

    button("Use my account's").click();

    expect(chosen).toEqual(['replace']);
  });

  it('can be backed out of', () => {
    // Unlike the welcome dialog: forcing an irreversible data decision on the
    // spot is how people lose things.
    let cancelled = 0;
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);

    button('Not now').click();

    expect(cancelled).toBe(1);
  });

  it('can be dismissed by clicking away', () => {
    let cancelled = 0;
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.ad-backdrop')
      ?.click();

    expect(cancelled).toBe(1);
  });

  it('locks the choices once one is taken', () => {
    // The write is in flight; a second answer would race the first.
    button('Keep both').click();
    fixture.detectChanges();

    expect(button('Keep both').disabled).toBe(true);
    expect(button("Use my account's").disabled).toBe(true);
  });
});
