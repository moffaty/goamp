import { trackEvent, init as initAptabase } from "@aptabase/web";
import * as Sentry from "@sentry/browser";

const SENTRY_DSN =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_GOAMP_SENTRY_DSN) ?? "";

const APTABASE_KEY = "A-EU-4215436752";

export function initAnalytics() {
  initAptabase(APTABASE_KEY, { host: "https://eu.aptabase.com" });

  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: "goamp@0.1.0",
    });
  }
}

export function track(event: string, props?: Record<string, string | number>) {
  trackEvent(event, props);
}

export function trackError(error: unknown, context?: Record<string, string>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack?.slice(0, 500) : undefined;

  // Send to Aptabase so errors are visible even without Sentry
  trackEvent("error", {
    message: message.slice(0, 200),
    ...(stack ? { stack } : {}),
    ...context,
  });

  // Also send to Sentry if configured
  if (error instanceof Error) {
    Sentry.captureException(error, { extra: context });
  } else {
    Sentry.captureMessage(message, { extra: context });
  }
}

// Global error handler
window.addEventListener("unhandledrejection", (e) => {
  trackError(e.reason, { type: "unhandled_promise" });
});

window.addEventListener("error", (e) => {
  trackError(e.error || e.message, { type: "uncaught_error" });
});
