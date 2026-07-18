import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withPreloading } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './auth.interceptor';
import { healthInterceptor } from './health.interceptor';
import { serverInterceptor } from './server.interceptor';
import { GlobalErrorHandler } from './global-error-handler';
import { SettingsPreloading } from './pages/settings/settings-preloading';

export const appConfig: ApplicationConfig = {
  providers: [
    // Forwards window `error` / `unhandledrejection` to Angular's ErrorHandler,
    // so a failed dynamic import (a rejected promise) reaches GlobalErrorHandler.
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes, withPreloading(SettingsPreloading)),
    provideHttpClient(withInterceptors([serverInterceptor, healthInterceptor, authInterceptor])),
  ],
};
