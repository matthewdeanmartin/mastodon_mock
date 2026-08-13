import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CorsProxySettings } from '../../../../providers/cors-proxy/cors-proxy-settings';
import { ConnectionCorsProxy } from './connection-cors-proxy';

describe('ConnectionCorsProxy', () => {
  let fixture: ComponentFixture<ConnectionCorsProxy>;
  let settings: CorsProxySettings;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ConnectionCorsProxy],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(ConnectionCorsProxy);
    settings = TestBed.inject(CorsProxySettings);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  const text = () => fixture.nativeElement.textContent as string;

  /** Press the radio for a proxy, the way the picker does. */
  const choose = (id: Parameters<ConnectionCorsProxy['choose']>[0]) => {
    fixture.componentInstance.choose(id);
    fixture.detectChanges();
  };

  const testButton = (): HTMLButtonElement | undefined =>
    [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      /Test proxy|Testing/.test((button as HTMLButtonElement).textContent ?? ''),
    ) as HTMLButtonElement | undefined;

  describe('switching proxies', () => {
    // The reported bug, in one test. A trial expires, the user picks a
    // replacement and presses Test, and the network shows a request to the *old*
    // proxy — because the selection only took effect on Save while Test read
    // what was saved. From the outside it looks like the picker is stuck.
    it('makes a newly chosen proxy the live one immediately', () => {
      settings.select('corsfix');
      choose('allorigins');

      expect(settings.currentId()).toBe('allorigins');
      expect(settings.resolve()?.entry.id).toBe('allorigins');
    });

    it('tests the proxy that is on screen, not the one it replaced', () => {
      settings.select('corsfix');
      choose('allorigins');

      fixture.componentInstance.runTest();
      const request = httpMock.expectOne((req) => req.url.includes('allorigins.win'));
      expect(request.request.url).not.toContain('corsfix');
      request.flush('<rss></rss>');
    });

    it('says which proxy took over, so the switch is not silent', () => {
      settings.select('corsfix');
      choose('allorigins');
      expect(text()).toContain('AllOrigins is now the active proxy');
    });
  });

  describe('the selections that cannot commit on click', () => {
    // Committing these would leave `resolve()` null — a "configured" proxy that
    // builds no request. The old selection stays live until Save, and the page
    // has to say so rather than let Test describe the wrong service.
    it('does not switch to a key-required proxy before a key exists', () => {
      settings.select('allorigins');
      choose('corssh');

      expect(settings.currentId()).toBe('allorigins');
    });

    it('switches to a key-required proxy once a key is already stored', () => {
      settings.select('allorigins');
      settings.setKey('a-key');
      choose('corssh');

      expect(settings.currentId()).toBe('corssh');
    });

    it('does not switch to custom before its template is saved', () => {
      settings.select('allorigins');
      choose('custom');

      expect(settings.currentId()).toBe('allorigins');
    });

    it('blocks the test button while the screen and the saved proxy disagree', () => {
      settings.select('allorigins');
      choose('corssh');
      fixture.detectChanges();

      expect(testButton()?.disabled).toBe(true);
      expect(text()).toContain('Save CORS.SH before testing it');
      // And it names what would otherwise have been tested behind the user's back.
      expect(text()).toContain('AllOrigins is still the one feeds use');
    });

    it('re-enables the test button once the pending choice is saved', () => {
      settings.select('allorigins');
      choose('custom');
      fixture.componentInstance['customTemplate'].set('https://mine.example.com/?url={url}');
      fixture.componentInstance.save();
      fixture.detectChanges();

      expect(settings.currentId()).toBe('custom');
      expect(testButton()?.disabled).toBe(false);
    });
  });

  it('offers cors.lol in the picker', () => {
    // Re-added after being struck off for rate-limiting; see the catalog note.
    expect(text()).toContain('cors.lol');
  });
});
