import { AfterViewChecked, Component, ElementRef, inject, OnInit, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HumanTimePipe } from '../human-time.pipe';
import { ElizaService } from './eliza.service';
import { LocalDmStore } from './local-dm-store';

/**
 * The viewer's private chat with Eliza — a scoped, browser-local DM surface.
 *
 * This is deliberately NOT the full {@link Conversations} page (which is behind
 * the anonymous guard and wired to the real chat APIs). Eliza's chat is the one
 * chat an anonymous visitor can have, so it lives on its own simple route,
 * reachable only once she's followed. Sending a message runs the ELIZA brain via
 * {@link LocalDmStore}; nothing touches the network.
 */
@Component({
  selector: 'app-eliza-chat',
  imports: [FormsModule, RouterLink, HumanTimePipe],
  templateUrl: './eliza-chat.html',
  styleUrl: './eliza-chat.css',
})
export class ElizaChat implements OnInit, AfterViewChecked {
  protected eliza = inject(ElizaService);
  protected dm = inject(LocalDmStore);
  private router = inject(Router);

  protected account = this.eliza.account();
  protected draft = '';

  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private inputBox = viewChild<ElementRef<HTMLInputElement>>('input');
  private pendingScroll = false;

  ngOnInit(): void {
    // The chat only exists once you follow Eliza. If you're not following,
    // send you to her profile to make that choice.
    if (!this.eliza.following()) {
      void this.router.navigateByUrl('/eliza');
      return;
    }
    this.dm.refresh();
    this.dm.ensureSeeded();
    this.pendingScroll = true;
  }

  ngAfterViewChecked(): void {
    if (this.pendingScroll) {
      this.pendingScroll = false;
      const el = this.scroller()?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  send(): void {
    const text = this.draft.trim();
    if (!text) {
      return;
    }
    this.dm.send(text);
    this.draft = '';
    this.pendingScroll = true;
    // Keep the cursor in the box so you can keep typing.
    this.inputBox()?.nativeElement.focus();
  }
}
