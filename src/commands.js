/**
 * Command registry — maps command names to handler functions.
 * Handlers receive (args, state) and return a result string for display.
 */

export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(name, handler, description = '') {
    this.commands.set(name.toLowerCase(), { handler, description });
  }

  execute(input, state) {
    const trimmed = input.trim().toLowerCase();
    const spaceIdx = trimmed.indexOf(' ');
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    if (!name) return null;

    const entry = this.commands.get(name);
    if (!entry) {
      return { ok: false, message: `unknown: /${name}` };
    }

    try {
      const result = entry.handler(args, state);
      return { ok: true, message: result || '' };
    } catch (e) {
      return { ok: false, message: `error: ${e.message}` };
    }
  }

  has(name) {
    return this.commands.has(name.toLowerCase());
  }

  list() {
    return Array.from(this.commands.entries()).map(([name, { description }]) => ({
      name,
      description,
    }));
  }
}
