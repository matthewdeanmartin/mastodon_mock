import { Pipe, PipeTransform } from '@angular/core';

const HOUR_MS = 60 * 60 * 1000;

/** Formats recent timestamps relatively, switching to a clock time after twelve hours. */
@Pipe({ name: 'humanTime', standalone: true, pure: false })
export class HumanTimePipe implements PipeTransform {
  transform(value: string): string {
    const timestamp = new Date(value);
    const elapsed = Math.max(0, Date.now() - timestamp.getTime());
    if (!Number.isFinite(elapsed)) {
      return '';
    }
    if (elapsed > 12 * HOUR_MS) {
      return timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
