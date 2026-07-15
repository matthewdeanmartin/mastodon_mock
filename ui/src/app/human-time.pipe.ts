import { Pipe, PipeTransform } from '@angular/core';

const HOUR_MS = 60 * 60 * 1000;

/** True when the two dates fall on the same local calendar day. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Formats recent timestamps relatively ("5 minutes ago"), then falls back by
 * age: same-day clock time → "yesterday" → same-year "Mar 3" → "Mar 3, 2006".
 */
@Pipe({ name: 'humanTime', standalone: true, pure: false })
export class HumanTimePipe implements PipeTransform {
  transform(value: string): string {
    const timestamp = new Date(value);
    const now = new Date();
    const elapsed = Math.max(0, now.getTime() - timestamp.getTime());
    if (!Number.isFinite(elapsed)) {
      return '';
    }
    if (elapsed > 12 * HOUR_MS) {
      if (sameDay(timestamp, now)) {
        return timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (sameDay(timestamp, yesterday)) {
        return 'yesterday';
      }
      if (timestamp.getFullYear() === now.getFullYear()) {
        return timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
      return timestamp.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    if (elapsed < 60_000) {
      const seconds = Math.max(1, Math.floor(elapsed / 1000));
      return `${seconds} ${seconds === 1 ? 'second' : 'seconds'} ago`;
    }
    if (elapsed < HOUR_MS) {
      const minutes = Math.floor(elapsed / 60_000);
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    }
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
}
