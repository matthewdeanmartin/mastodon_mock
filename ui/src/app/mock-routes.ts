import { Routes } from '@angular/router';

/**
 * Routes that only make sense against the mock server (its `_mock/*` control plane).
 *
 * In the standalone "Mocking Bird" build this whole file is replaced by
 * `mock-routes.mockingbird.ts` (an empty array), via the `mockingbird` configuration's
 * `fileReplacements` in angular.json. Replacing the file — rather than guarding with a
 * runtime flag — ensures the lazy `import()` literal below is not present in the
 * Mocking Bird source, so its chunk is never emitted.
 */
export const mockOnlyChildren: Routes = [
  {
    path: 'dev/faults',
    loadComponent: () =>
      import('./pages/fault-injection/fault-injection').then((m) => m.FaultInjection),
  },
];
