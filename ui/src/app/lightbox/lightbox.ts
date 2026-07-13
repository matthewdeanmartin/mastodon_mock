import { Component, HostListener, computed, input, output, signal } from '@angular/core';
import { MediaAttachment } from '../models';

/**
 * A full-screen image viewer: centers the current image, dims the page behind
 * it, and lets the user page through a status's attachments like a slideshow.
 */
@Component({
  selector: 'app-lightbox',
  imports: [],
  templateUrl: './lightbox.html',
  styleUrl: './lightbox.css',
})
export class Lightbox {
  /** The images to page through. */
  readonly items = input.required<MediaAttachment[]>();
  /** Index of the image to show first. */
  readonly startIndex = input(0);
  /** Emitted when the viewer should close. */
  readonly closed = output<void>();

  protected index = signal(0);

  constructor() {
    // Seed the current index from the requested start once inputs are set.
    queueMicrotask(() => this.index.set(this.startIndex()));
  }

  protected current = computed(() => this.items()[this.index()] ?? null);
  protected hasMultiple = computed(() => this.items().length > 1);

  prev(event: Event): void {
    event.stopPropagation();
    this.index.update((i) => (i - 1 + this.items().length) % this.items().length);
  }

  next(event: Event): void {
    event.stopPropagation();
    this.index.update((i) => (i + 1) % this.items().length);
  }

  close(): void {
    this.closed.emit();
  }

  /** Close only when the backdrop itself is clicked, not the image/controls. */
  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    } else if (event.key === 'ArrowRight' && this.hasMultiple()) {
      this.next(event);
    } else if (event.key === 'ArrowLeft' && this.hasMultiple()) {
      this.prev(event);
    }
  }
}
