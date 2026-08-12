import { Route } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

/**
 * The guarded shell — the `''` route that has children, as distinct from the
 * public front page, which also sits at `''` but is `pathMatch: 'full'` and has
 * none. Matching on `children` rather than on the path is what keeps this
 * helper pointed at the shell now that two routes share the empty path.
 */
function shellRoute(): Route | undefined {
  return routes.find((route) => route.path === '' && !!route.children);
}

function shellChild(path: string): Route | undefined {
  return shellRoute()?.children?.find((route) => route.path === path);
}

describe('application routes', () => {
  it('provides a shareable Anonymous entry route', () => {
    expect(routes.find((route) => route.path === 'anonymous')?.loadComponent).toBeDefined();
  });

  /**
   * The front door. Two routes share the empty path — the public pitch page and
   * the guarded shell — and the order plus `pathMatch: 'full'` is the only thing
   * keeping them apart. Get it wrong and either strangers hit the auth guard
   * again or every in-app route stops resolving.
   */
  describe('the public front door', () => {
    const frontRoute = (): Route | undefined =>
      routes.find((route) => route.path === '' && !route.children);

    it('serves an unguarded front page at the root', () => {
      const front = frontRoute();

      expect(front?.loadComponent).toBeDefined();
      expect(front?.canActivate).toBeUndefined();
    });

    it('matches the root exactly, so it cannot swallow every in-app route', () => {
      expect(frontRoute()?.pathMatch).toBe('full');
    });

    it('is declared before the guarded shell, or the guard would win at /', () => {
      const frontIndex = routes.findIndex((route) => route.path === '' && !route.children);
      const shellIndex = routes.findIndex((route) => route.path === '' && !!route.children);

      expect(frontIndex).toBeGreaterThanOrEqual(0);
      expect(shellIndex).toBeGreaterThan(frontIndex);
    });

    /**
     * `/` is the pitch page now, so an unknown URL must not land there: a
     * signed-in user who fat-fingers a path would read it as a logout. The auth
     * guard forwards a visitor with no account on to `/` from `/home` anyway.
     */
    it('sends unknown URLs to Home rather than to the pitch page', () => {
      expect(routes.find((route) => route.path === '**')?.redirectTo).toBe('home');
    });
  });

  /**
   * `/login` is both the chooser and the Mastodon OAuth callback address: the
   * flow registers `<base href>login` with the remote instance as its
   * `redirect_uri`, and instances validate the callback against exactly what was
   * registered. So the route cannot move, and it must match `full` so
   * `/login/mastodon` reaches its own page instead of the chooser.
   */
  describe('the login doors', () => {
    it('keeps the chooser at /login, matched exactly', () => {
      const chooser = routes.find((route) => route.path === 'login');

      expect(chooser?.loadComponent).toBeDefined();
      expect(chooser?.pathMatch).toBe('full');
      expect(chooser?.canActivate).toBeUndefined();
    });

    it('gives each network its own unguarded page', () => {
      for (const path of ['login/mastodon', 'login/bluesky']) {
        const route = routes.find((r) => r.path === path);
        expect(route?.loadComponent).toBeDefined();
        expect(route?.canActivate).toBeUndefined();
      }
    });
  });

  it('gives the public invitation builder its own guarded instance of the standard shell', () => {
    const inviteRoute = routes.find((route) => route.path === 'invites');

    expect(inviteRoute?.loadComponent).toBeDefined();
    expect(inviteRoute?.canActivate).toHaveLength(1);
    expect(inviteRoute?.children?.find((child) => child.path === '')?.loadComponent).toBeDefined();
    expect(shellChild('invites')).toBeUndefined();
  });

  it('keeps both current and legacy message links available to Anonymous', () => {
    expect(routes.find((route) => route.path === 'message/:id')?.canActivate).toBeUndefined();
    expect(routes.find((route) => route.path === 'message')?.canActivate).toBeUndefined();
  });

  it('keeps public hashtag timelines available to Anonymous', () => {
    const tagRoute = shellChild('tags/:tag');

    expect(tagRoute).toBeDefined();
    expect(tagRoute?.canActivate).toBeUndefined();
  });

  it('keeps observability available to Anonymous', () => {
    expect(shellChild('observability')?.canActivate).toBeUndefined();
  });

  it('guards pastebin routes behind the pastebin feature flag', () => {
    const route = shellChild('pastes');

    expect(route?.data?.['featureFlag']).toBe('pastebin');
    expect(route?.canActivate).toHaveLength(1);
  });

  it('keeps interaction-only routes guarded from Anonymous', () => {
    expect(shellChild('favourites')?.canActivate).toHaveLength(1);
  });

  it('guards the writing workspace behind the write feature flag', () => {
    const route = shellChild('write');

    expect(route?.data?.['featureFlag']).toBe('write');
    expect(route?.canActivate).toHaveLength(1);
  });

  it('leaves the writing workspace open to Anonymous, who have local drafts too', () => {
    // The flag guard is the only guard: an anonymous visitor's drafts and notes
    // are browser-local, so the whole page works without a server identity.
    expect(shellChild('write')?.canActivate).toHaveLength(1);
    expect(shellChild('drafts')?.canActivate).toBeUndefined();
  });
});
