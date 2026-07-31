import { Route } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

function shellChild(path: string): Route | undefined {
  return routes.find((route) => route.path === '')?.children?.find((route) => route.path === path);
}

describe('application routes', () => {
  it('provides a shareable Anonymous entry route', () => {
    expect(routes.find((route) => route.path === 'anonymous')?.loadComponent).toBeDefined();
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
});
