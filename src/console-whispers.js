/**
 * Whisper system — sparse, stateful, authored lines that the console
 * may emit after a command executes. Feels like a haunted curator
 * commenting on what the player does, not a help system.
 *
 * Usage:
 *   const whispers = new WhisperSystem();
 *   // after command dispatch:
 *   const line = whispers.evaluate(context);
 *   if (line) showWhisper(line);
 */

// ── Session memory ──

function createMemory() {
  return {
    totalCommands:    0,
    commandCounts:    {},          // command → count
    history:          [],          // last N command names (newest last)
    recentWhispers:   [],          // ids of recently shown whispers
    discovered:       new Set(),   // commands used at least once
    failStreak:       0,           // consecutive unknown-command attempts
    lastCommand:      null,
    lastOk:           true,
    mood: {
      curiosity:  0,              // rises with /debug, /chunks, exploratory use
      suspicion:  0,              // rises with repeated unknown commands
      mischief:   0,              // rises with toggle-spam, odd sequences
    },
  };
}

// ── Condition helpers ──

const cond = {
  /** First time this command was ever used */
  firstUse: (cmd) => (ctx) => ctx.commandCounts[cmd] === 1,

  /** Nth use of a command (exact) */
  nthUse: (cmd, n) => (ctx) => ctx.commandCounts[cmd] === n,

  /** Command used at least N times */
  minUse: (cmd, n) => (ctx) => (ctx.commandCounts[cmd] || 0) >= n,

  /** Current command matches */
  command: (cmd) => (ctx) => ctx.command === cmd,

  /** Previous command was this */
  after: (prev) => (ctx) => ctx.previousCommand === prev,

  /** Command failed (unknown) */
  failed: () => (ctx) => !ctx.ok,

  /** N or more consecutive failures */
  failStreak: (n) => (ctx) => ctx.failStreak >= n,

  /** Total commands this session exceeds threshold */
  totalOver: (n) => (ctx) => ctx.totalCommands > n,

  /** Mood value exceeds threshold */
  moodOver: (key, n) => (ctx) => ctx.mood[key] > n,

  /** Command was toggled (used, then used again = toggling) */
  toggleRepeat: (cmd) => (ctx) =>
    ctx.command === cmd && ctx.previousCommand === cmd,

  /** All conditions must pass */
  all: (...fns) => (ctx) => fns.every(fn => fn(ctx)),

  /** Any condition passes */
  any: (...fns) => (ctx) => fns.some(fn => fn(ctx)),
};

// ── Whisper library ──
// Each entry: { id, condition, line, weight?, cooldown? }
//   condition: function(ctx) → bool
//   line:      string to display
//   weight:    selection weight (default 1)
//   cooldown:  minimum commands before this line can repeat (default 12)

const WHISPER_LIBRARY = [

  // ── debug ──
  {
    id: 'debug-second',
    condition: cond.all(cond.command('debug'), cond.nthUse('debug', 2)),
    line: '...interesting. try /dark, since you\'re so curious.',
    weight: 1,
    cooldown: 40,
  },
  {
    id: 'debug-fifth',
    condition: cond.all(cond.command('debug'), cond.nthUse('debug', 5)),
    line: 'you keep looking behind the curtain',
    weight: 1,
    cooldown: 60,
  },
  {
    id: 'debug-toggle',
    condition: cond.all(cond.command('debug'), cond.toggleRepeat('debug')),
    line: 'again?',
    weight: 0.6,
    cooldown: 8,
  },

  // ── dark ──
  {
    id: 'dark-first',
    condition: cond.all(cond.command('dark'), cond.firstUse('dark')),
    line: 'careful',
    weight: 0.8,
    cooldown: 60,
  },
  {
    id: 'dark-after-debug',
    condition: cond.all(cond.command('dark'), cond.after('debug')),
    line: 'better',
    weight: 1,
    cooldown: 30,
  },
  {
    id: 'dark-many',
    condition: cond.all(cond.command('dark'), cond.minUse('dark', 4)),
    line: 'you like it here',
    weight: 0.4,
    cooldown: 25,
  },

  // ── hell ──
  {
    id: 'hell-first',
    condition: cond.all(cond.command('hell'), cond.firstUse('hell')),
    line: 'you asked for this',
    weight: 1,
    cooldown: 60,
  },
  {
    id: 'hell-after-dark',
    condition: cond.all(cond.command('hell'), cond.after('dark')),
    line: 'deeper, then',
    weight: 0.7,
    cooldown: 30,
  },

  // ── normal ──
  {
    id: 'normal-return',
    condition: cond.all(cond.command('normal'), cond.minUse('normal', 2)),
    line: 'running back?',
    weight: 0.5,
    cooldown: 20,
  },
  {
    id: 'normal-after-hell',
    condition: cond.all(cond.command('normal'), cond.after('hell')),
    line: 'wise',
    weight: 0.8,
    cooldown: 30,
  },

  // ── rain ──
  {
    id: 'rain-first',
    condition: cond.all(cond.command('rain'), cond.firstUse('rain')),
    line: 'listen',
    weight: 0.6,
    cooldown: 60,
  },

  // ── day ──
  {
    id: 'day-after-dark',
    condition: cond.all(cond.command('day'), cond.after('dark')),
    line: 'you blinked',
    weight: 0.7,
    cooldown: 30,
  },

  // ── seed ──
  {
    id: 'seed-second',
    condition: cond.all(cond.command('seed'), cond.nthUse('seed', 2)),
    line: 'looking for something specific?',
    weight: 0.6,
    cooldown: 25,
  },
  {
    id: 'seed-many',
    condition: cond.all(cond.command('seed'), cond.minUse('seed', 5)),
    line: 'it won\'t be the same forest twice',
    weight: 0.5,
    cooldown: 40,
  },

  // ── tp ──
  {
    id: 'tp-first',
    condition: cond.all(cond.command('tp'), cond.firstUse('tp')),
    line: 'the path was here all along',
    weight: 0.5,
    cooldown: 60,
  },

  // ── chunks ──
  {
    id: 'chunks-after-debug',
    condition: cond.all(cond.command('chunks'), cond.after('debug')),
    line: 'you really want to see the seams',
    weight: 0.7,
    cooldown: 30,
  },

  // ── toggle spam (any command) ──
  {
    id: 'generic-toggle',
    condition: (ctx) => ctx.command === ctx.previousCommand && ctx.commandCounts[ctx.command] >= 3,
    line: 'again?',
    weight: 0.4,
    cooldown: 6,
  },

  // ── unknown commands ──
  {
    id: 'unknown-second',
    condition: cond.all(cond.failed(), cond.failStreak(2)),
    line: 'that\'s not a word it knows',
    weight: 0.8,
    cooldown: 10,
  },
  {
    id: 'unknown-streak',
    condition: cond.all(cond.failed(), cond.failStreak(4)),
    line: 'guessing won\'t help',
    weight: 1,
    cooldown: 15,
  },
  {
    id: 'unknown-persistent',
    condition: cond.all(cond.failed(), cond.failStreak(7)),
    line: 'stop',
    weight: 1,
    cooldown: 20,
  },

  // ── rare / eerie / late-session ──
  {
    id: 'rare-noticed',
    condition: cond.all(cond.totalOver(25), cond.moodOver('curiosity', 5)),
    line: 'it noticed',
    weight: 0.15,
    cooldown: 80,
  },
  {
    id: 'rare-quiet',
    condition: cond.totalOver(40),
    line: 'the trees are quieter when you\'re here',
    weight: 0.06,
    cooldown: 100,
  },
  {
    id: 'rare-watching',
    condition: cond.all(cond.totalOver(15), cond.moodOver('suspicion', 3)),
    line: 'it remembers what you typed',
    weight: 0.1,
    cooldown: 80,
  },
  {
    id: 'rare-mischief',
    condition: cond.moodOver('mischief', 6),
    line: 'you\'re not the first',
    weight: 0.08,
    cooldown: 100,
  },
];

// ── Whisper system ──

export class WhisperSystem {
  constructor() {
    this.mem = createMemory();
    this.cooldowns = {};  // whisper id → commands remaining until eligible
  }

  /**
   * Call after every command dispatch.
   * @param {object} params
   * @param {string} params.command  - parsed command name (lowercase, no slash)
   * @param {boolean} params.ok      - whether the command was recognised/succeeded
   * @returns {string|null} a whisper line, or null for silence
   */
  evaluate({ command, ok }) {
    const mem = this.mem;

    // ── update memory ──
    mem.totalCommands++;
    mem.commandCounts[command] = (mem.commandCounts[command] || 0) + 1;

    if (ok) {
      mem.discovered.add(command);
      mem.failStreak = 0;
    } else {
      mem.failStreak++;
    }

    // mood adjustments
    if (['debug', 'chunks', 'seed'].includes(command) && ok) {
      mem.mood.curiosity += 1;
    }
    if (!ok) {
      mem.mood.suspicion += 0.8;
    }
    if (command === mem.lastCommand) {
      mem.mood.mischief += 0.5;
    }

    // build evaluation context
    const ctx = {
      command,
      ok,
      previousCommand:  mem.lastCommand,
      commandCounts:    mem.commandCounts,
      totalCommands:    mem.totalCommands,
      failStreak:       mem.failStreak,
      discovered:       mem.discovered,
      mood:             mem.mood,
    };

    // ── tick all cooldowns ──
    for (const id in this.cooldowns) {
      if (this.cooldowns[id] > 0) this.cooldowns[id]--;
    }

    // ── collect eligible whispers ──
    const eligible = [];
    for (const entry of WHISPER_LIBRARY) {
      // skip if on cooldown
      if (this.cooldowns[entry.id] > 0) continue;
      // skip if recently shown
      if (mem.recentWhispers.includes(entry.id)) continue;
      // evaluate condition
      try {
        if (!entry.condition(ctx)) continue;
      } catch {
        continue;
      }
      eligible.push(entry);
    }

    // ── update trailing state ──
    mem.lastCommand = command;
    mem.lastOk = ok;
    mem.history.push(command);
    if (mem.history.length > 20) mem.history.shift();

    // ── weighted selection ──
    if (eligible.length === 0) return null;

    const totalWeight = eligible.reduce((s, e) => s + (e.weight ?? 1), 0);
    let roll = Math.random() * totalWeight;
    let chosen = eligible[0];
    for (const entry of eligible) {
      roll -= (entry.weight ?? 1);
      if (roll <= 0) { chosen = entry; break; }
    }

    // apply cooldown + recent tracking
    this.cooldowns[chosen.id] = chosen.cooldown ?? 12;
    mem.recentWhispers.push(chosen.id);
    if (mem.recentWhispers.length > 5) mem.recentWhispers.shift();

    return chosen.line;
  }
}
