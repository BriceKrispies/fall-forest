/**
 * Console HUD — floating "/" that expands into a command input line.
 * Pure DOM overlay above the canvas. Does not touch the renderer.
 */

import { WhisperSystem } from './console-whispers.js';

export class GameConsole {
  constructor(commands) {
    this.commands = commands;
    this.open = false;
    this.gameState = null;
    this.feedbackTimer = null;
    this.whisperTimer = null;
    this.whispers = new WhisperSystem();

    this._build();
    this._bindKeys();
    this._bindTouch();
  }

  /** Provide the shared game state object that command handlers can read/write */
  setGameState(state) {
    this.gameState = state;
  }

  /** Returns true when the console is open and should suppress game input */
  isOpen() {
    return this.open;
  }

  _build() {
    // Container
    this.el = document.createElement('div');
    this.el.id = 'console';
    this.el.className = 'console-closed';

    // Floating slash — wrap in a tap target div for mobile
    this.slashWrap = document.createElement('div');
    this.slashWrap.id = 'console-slash-wrap';

    this.slash = document.createElement('span');
    this.slash.id = 'console-slash';
    this.slash.textContent = '/';
    this.slashWrap.appendChild(this.slash);
    this.el.appendChild(this.slashWrap);

    // Input field (hidden until open)
    this.input = document.createElement('input');
    this.input.id = 'console-input';
    this.input.type = 'text';
    this.input.inputMode = 'text';
    this.input.autocomplete = 'off';
    this.input.autocapitalize = 'off';
    this.input.autocorrect = 'off';
    this.input.spellcheck = false;
    this.input.enterKeyHint = 'go';
    this.el.appendChild(this.input);

    // Submit button for mobile (visible only when open on touch devices)
    this.submitBtn = document.createElement('button');
    this.submitBtn.id = 'console-submit';
    this.submitBtn.textContent = '\u2192'; // →
    this.submitBtn.type = 'button';
    this.el.appendChild(this.submitBtn);

    // Feedback line
    this.feedback = document.createElement('div');
    this.feedback.id = 'console-feedback';
    this.el.appendChild(this.feedback);

    // Whisper line (second, delayed feedback)
    this.whisper = document.createElement('div');
    this.whisper.id = 'console-whisper';
    this.el.appendChild(this.whisper);

    document.body.appendChild(this.el);
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      // "/" opens the console (only when closed and not in an input already)
      if (!this.open && (e.key === '/' || e.code === 'Slash') && e.target === document.body) {
        e.preventDefault();
        e.stopPropagation();
        this._openConsole();
        return;
      }

      if (!this.open) return;

      // Prevent game input while console is open
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeConsole();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._submit();
      }
    }, true); // capture phase — intercept before game handlers

    // Also handle soft-keyboard "Go" / "Enter" via the input's own event
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._submit();
      }
    });
  }

  _bindTouch() {
    // Tap the slash area to open — use click (fires after touch on all platforms,
    // and the browser correctly chains focus from click to the subsequent input.focus())
    this.slashWrap.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.open) {
        this._closeConsole();
      } else {
        this._openConsole();
      }
    });

    // Prevent the slash tap from being captured by the canvas touch-look handler
    this.slashWrap.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });
    this.slashWrap.addEventListener('touchend', (e) => {
      e.stopPropagation();
    });

    // Submit button (mobile fallback)
    this.submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._submit();
    });
    this.submitBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });

    // Prevent touches on the input from being captured by the canvas
    this.input.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });

    // Close when tapping outside while open (canvas tap)
    document.addEventListener('touchstart', (e) => {
      if (!this.open) return;
      // If the tap is inside the console container, let it through
      if (this.el.contains(e.target)) return;
      this._closeConsole();
    });
  }

  _openConsole() {
    this.open = true;
    this.el.className = 'console-open';
    this.input.value = '';
    // Defer focus slightly so the DOM transition has started and mobile
    // browsers accept the focus as user-gesture-initiated
    requestAnimationFrame(() => {
      this.input.focus({ preventScroll: true });
    });
    this._clearFeedback();
  }

  _closeConsole() {
    this.open = false;
    this.el.className = 'console-closed';
    this.input.blur();
    this.input.value = '';
  }

  _submit() {
    const raw = this.input.value.trim();
    if (!raw) {
      this._closeConsole();
      return;
    }

    const result = this.commands.execute(raw, this.gameState);
    if (result && result.message) {
      this._showFeedback(result.message);
    }

    // Parse command name for whisper context
    const trimmed = raw.trim().toLowerCase();
    const spaceIdx = trimmed.indexOf(' ');
    const cmdName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);

    const whisperLine = this.whispers.evaluate({
      command: cmdName,
      ok: result ? result.ok : false,
    });
    if (whisperLine) {
      this._showWhisper(whisperLine);
    }

    this.input.value = '';
    this._closeConsole();
  }

  _showFeedback(text) {
    this._clearFeedback();
    this.feedback.textContent = text;
    this.feedback.classList.add('visible');
    this.feedbackTimer = setTimeout(() => {
      this.feedback.classList.remove('visible');
    }, 2500);
  }

  _clearFeedback() {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    this.feedback.classList.remove('visible');
    this.feedback.textContent = '';
    this._clearWhisper();
  }

  _showWhisper(text) {
    this._clearWhisper();
    // Delay the whisper so it appears after the normal feedback
    this.whisperTimer = setTimeout(() => {
      this.whisper.textContent = text;
      this.whisper.classList.add('visible');
      this.whisperTimer = setTimeout(() => {
        this.whisper.classList.remove('visible');
      }, 3200);
    }, 1200);
  }

  _clearWhisper() {
    if (this.whisperTimer) {
      clearTimeout(this.whisperTimer);
      this.whisperTimer = null;
    }
    this.whisper.classList.remove('visible');
    this.whisper.textContent = '';
  }
}
