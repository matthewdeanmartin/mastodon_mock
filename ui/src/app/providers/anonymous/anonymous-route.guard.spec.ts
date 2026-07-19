import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { anonymousUnavailableGuard } from './anonymous-route.guard';

describe('anonymousUnavailableGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  function run(feature = 'Messages') {
    return TestBed.runInInjectionContext(() =>
      anonymousUnavailableGuard(
        { data: { anonymousFeature: feature } } as unknown as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
      ),
    );
  }

  it('allows authenticated accounts through', () => {
    TestBed.inject(Auth).setToken('token');
    expect(run()).toBe(true);
  });

  it('redirects Anonymous before the protected page can load', () => {
    TestBed.inject(Auth).enterAnonymous();
    const result = run('Messages');
    expect(TestBed.inject(Router).serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe(
      '/unavailable?feature=Messages',
    );
  });
});
