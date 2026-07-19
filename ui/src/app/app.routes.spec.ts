import { Route } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

function shellChild(path: string): Route | undefined {
  return routes.find((route) => route.path === '')?.children?.find((route) => route.path === path);
}

describe('application routes', () => {
  it('keeps public hashtag timelines available to Anonymous', () => {
    const tagRoute = shellChild('tags/:tag');

    expect(tagRoute).toBeDefined();
    expect(tagRoute?.canActivate).toBeUndefined();
  });

  it('keeps interaction-only routes guarded from Anonymous', () => {
    expect(shellChild('favourites')?.canActivate).toHaveLength(1);
  });
});
