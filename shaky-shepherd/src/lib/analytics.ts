export type AnalyticsParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Fire a Google Analytics 4 event. Uses whatever `window.gtag` is installed
 * (the inline GA snippet queues into dataLayer; gtag.js replaces it with the
 * real implementation once loaded). Never throws — analytics must not break
 * gameplay, and events are discrete (start / over / level up / pause / …),
 * never per-frame.
 */
export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
  } catch (error) {
    console.warn('[serpent] analytics event dropped:', error);
  }
}