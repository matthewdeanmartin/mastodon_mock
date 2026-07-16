import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './auth.interceptor';
import { healthInterceptor } from './health.interceptor';
import { serverInterceptor } from './server.interceptor';
import { GlobalErrorHandler } from './global-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    // Forwards window `error` / `unhandledrejection` to Angular's ErrorHandler,
    // so a failed dynamic import (a rejected promise) reaches GlobalErrorHandler.
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes),
    provideHttpClient(withInterceptors([serverInterceptor, healthInterceptor, authInterceptor])),
  ],
};
