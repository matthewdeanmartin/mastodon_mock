import { Component, HostListener, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isLive, TagCheck, TagHelper, TagHelperResult } from '../tag-helper';

/**
 * 🤖#️⃣ — hashtag suggestions for the post being written.
 *
 * Like the search helper, this never acts: it hands a list of tags back to the
 * compose box, and the user edits them first. Live tags are pre-selected; dead
 * ones are shown anyway (greyed, with the count) because "nobody uses this" is
 * useful information, and occasionally you want the tag regardless.
 */
@Component({
  selector: 'app-tag-helper-dialog',
  imports: [FormsModule],
  templateUrl: './tag-helper-dialog.html',
  styleUrl: './tag-helper-dialog.css',
})
export class TagHelperDialog {
  private helper = inject(TagHelper);

  /** The post text being tagged. */
  readonly post = input.required<string>();

  readonly useTags = output<string[]>();
  readonly closed = output<void>();

  protected busy = signal(false);
  protected error = signal<string | null>(null);
  protected result = signal<TagHelperResult | null>(null);
  /** The editable, space-separated tag line. Seeded from the live tags. */
  protected draft = signal('');

  protected readonly isLive = isLive;

  async suggest(): Promise<void> {
    const post = this.post().trim();
    if (!post || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      const result = await this.helper.run(post);
      this.result.set(result);
      // Seed with what has traffic; fall back to everything suggested so the
      // user always has something to edit rather than an empty box.
      const seed = result.live.length ? result.live : result.checked.map((c) => c.tag);
      this.draft.set(seed.join(' '));
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : "Couldn't reach the model.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Add or remove one tag from the editable line. */
  toggle(check: TagCheck): void {
    const tags = this.draftTags();
    const index = tags.findIndex((t) => t.toLowerCase() === check.tag.toLowerCase());
    if (index >= 0) {
      tags.splice(index, 1);
    } else {
      tags.push(check.tag);
    }
    this.draft.set(tags.join(' '));
  }

  protected selected(check: TagCheck): boolean {
    return this.draftTags().some((t) => t.toLowerCase() === check.tag.toLowerCase());
  }

  use(): void {
    const tags = this.draftTags();
    if (tags.length) {
      this.useTags.emit(tags);
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }

  /** The draft parsed into bare tag names, however the user punctuated it. */
  private draftTags(): string[] {
    return this.draft()
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
  }

  protected usesLabel(check: TagCheck): string {
    if (check.uses === null) {
      return "couldn't check";
    }
    if (check.uses === 0) {
      return 'unused here';
    }
    return `${check.uses} recent use${check.uses === 1 ? '' : 's'}`;
  }

  protected summary(result: TagHelperResult): string {
    const calls = `${result.callsUsed} lookup${result.callsUsed === 1 ? '' : 's'}`;
    const rewritten = result.refined ? ', after one rewrite' : '';
    if (!result.live.length) {
      return `None of these are in use on this server${rewritten} — ${calls}. Edit below, or post without tags.`;
    }
    return `${result.live.length} of these are in real use${rewritten} — ${calls}.`;
  }
}
