export type TrackEvent = string;
export function visitorId(): string { return ""; }
export function track(_event: TrackEvent, _props?: Record<string, string | number | boolean>): void {}
export function trackPageView(_path: string): void {}
