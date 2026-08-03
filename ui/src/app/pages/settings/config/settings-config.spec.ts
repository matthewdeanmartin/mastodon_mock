import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasteHistory } from '../../../providers/paste/paste-history';
import { SettingsConfig } from './settings-config';

describe('SettingsConfig', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('previews an export without downloading, copying, or publishing it', () => {
    const fixture = TestBed.createComponent(SettingsConfig);
    fixture.detectChanges();

    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.includes('Preview JSON'),
    )!;
    button.click();
    fixture.detectChanges();

    const preview = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '[aria-label="Export JSON preview"]',
    );
    expect(preview?.value).toContain('mockingbird-client-config');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nothing was downloaded, copied, or published',
    );
    http.expectNone('https://www.pastepile.com/api/public/pastes');
  });

  it('requires a publish preview and saves the paste plus edit password in My Pastes', async () => {
    const fixture = TestBed.createComponent(SettingsConfig);
    fixture.detectChanges();
    const buttons = () => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ];

    buttons()
      .find((button) => button.textContent?.includes('Preview Pastepile publish'))!
      .click();
    fixture.detectChanges();
    http.expectNone('https://www.pastepile.com/api/public/pastes');

    buttons()
      .find((button) => button.textContent?.includes('Publish this preview'))!
      .click();
    const request = http.expectOne('https://www.pastepile.com/api/public/pastes');
    const content = String(request.request.body['content']);
    const fetchMock = vi.fn().mockResolvedValue(new Response(content, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    request.flush({
      slug: 'config-1',
      url: 'https://www.pastepile.com/p/config-1',
      raw_url: 'https://www.pastepile.com/raw/config-1',
      edit_key: 'edit-secret',
    });

    await vi.waitFor(() => expect(TestBed.inject(PasteHistory).records()).toHaveLength(1));
    fixture.detectChanges();

    const history = TestBed.inject(PasteHistory);
    expect(history.records()[0]).toMatchObject({
      providerId: 'pastepile',
      title: 'Mockingbird client configuration',
      expiry: 'never',
      visibility: 'unlisted',
    });
    expect(history.editKeyFor('config-1')).toBe('edit-secret');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Manage in My Pastes');
  });

  it('shows copy success beside the export controls', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      userAgent: navigator.userAgent,
      clipboard: { writeText },
    });
    const fixture = TestBed.createComponent(SettingsConfig);
    fixture.detectChanges();

    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Copy JSON'))!
      .click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Configuration copied to the clipboard',
    );
  });
});
