'use strict';

const logger = require('../../utils/logger');

/**
 * RouteWise — Dona Personality Enforcement (PRD Section 14)
 *
 * All outbound messages must be routed through formatMessage() before
 * being sent to the Telegram group.  This module enforces the tone,
 * style, and length rules that define Dona's voice.
 *
 * Rules (PRD Section 14.2):
 *  - Max 200 words per message; truncate + summarise if over.
 *  - Max 2 emoji per message; strip extras.
 *  - Every message ends with a clear next step or question.
 *  - No ALL CAPS words (except single-word emphasis); convert to Title Case.
 *  - No filler phrases: Great!, Sure!, Absolutely!, Of course!, Certainly!
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_WORDS = 200;
const MAX_EMOJI = 2;

/**
 * Filler phrases that Dona never uses.
 * We match these as leading words/phrases at the start of a sentence or
 * the very beginning of the message (with optional whitespace / punctuation).
 */
const FILLER_PHRASES = [
  'Great!',
  'Sure!',
  'Absolutely!',
  'Of course!',
  'Certainly!',
  'Great,',
  'Sure,',
  'Absolutely,',
  'Of course,',
  'Certainly,',
  'No problem!',
  'No problem,',
  'Of course.',
];

/**
 * Default call-to-action appended when a message has no trailing question
 * or next-step cue.
 */
const DEFAULT_CTA = 'Which works best?';

// ─────────────────────────────────────────────────────────────────────────────
// Emoji utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unicode emoji regex (broad match; covers most common emoji including ZWJ
 * sequences, variation selectors, Fitzpatrick modifiers, flags).
 */
const EMOJI_REGEX = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

/**
 * Count emoji in a string.
 * @param {string} text
 * @returns {number}
 */
function countEmoji(text) {
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Strip emoji beyond the allowed maximum.
 * Keeps the FIRST maxAllowed emoji and removes any extra ones.
 *
 * @param {string} text
 * @param {number} [maxAllowed=MAX_EMOJI]
 * @returns {string}
 */
function limitEmoji(text, maxAllowed = MAX_EMOJI) {
  let count = 0;
  return text.replace(EMOJI_REGEX, (match) => {
    count++;
    return count <= maxAllowed ? match : '';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Word count utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count words in a string (splits on whitespace; emoji count as words).
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Truncate text to at most maxWords words, appending "…" if truncated.
 * Attempts to break at sentence boundaries first.
 *
 * @param {string} text
 * @param {number} [maxWords=MAX_WORDS]
 * @returns {string}
 */
function truncateToWordLimit(text, maxWords = MAX_WORDS) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;

  // Try to find the last sentence boundary within the limit
  const limited = words.slice(0, maxWords).join(' ');

  // Prefer breaking on '. ' or '.\n'
  const lastPeriod = Math.max(
    limited.lastIndexOf('. '),
    limited.lastIndexOf('.\n'),
    limited.lastIndexOf('! '),
    limited.lastIndexOf('? '),
  );

  if (lastPeriod > limited.length * 0.5) {
    // Good sentence boundary found in the second half of the text
    return limited.slice(0, lastPeriod + 1).trim();
  }

  return limited + '…';
}

// ─────────────────────────────────────────────────────────────────────────────
// Filler phrase removal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip known filler opener phrases from the beginning of a message.
 * e.g. "Great! Here's your options" → "Here's your options"
 *
 * @param {string} text
 * @returns {string}
 */
function stripFillers(text) {
  let result = text;
  let changed = true;

  // Iterate until no more fillers are removed (handles stacked fillers)
  while (changed) {
    changed = false;
    for (const filler of FILLER_PHRASES) {
      // Match at the very start (ignoring leading whitespace)
      const regex = new RegExp(
        '^\\s*' + filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*',
        'i'
      );
      if (regex.test(result)) {
        result  = result.replace(regex, '');
        changed = true;
      }
    }
  }

  return result.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL CAPS enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert ALL-CAPS words (2+ letters, all upper) to Title Case,
 * UNLESS it is the only word being "emphasised" in the message
 * (i.e. there is only one such word and the message is short enough
 * that a single emphasis makes sense).
 *
 * PRD: "Never use ALL CAPS except for a single-word emphasis."
 * Interpretation: if there is exactly ONE all-caps word we leave it;
 * any additional all-caps words are converted to Title Case.
 *
 * @param {string} text
 * @returns {string}
 */
function fixAllCaps(text) {
  // Find all ALL-CAPS words (≥2 chars, all uppercase letters, not acronyms like "ETA")
  const capsPattern = /\b([A-Z]{2,})\b/g;
  const capsWords   = [...text.matchAll(capsPattern)].map(m => m[1]);

  // If there is at most one ALL-CAPS word, it may be intentional emphasis — leave it.
  if (capsWords.length <= 1) return text;

  // More than one ALL-CAPS word: convert all to Title Case.
  return text.replace(capsPattern, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether the text already ends with a question or clear next step.
 * @param {string} text
 * @returns {boolean}
 */
function hasCTA(text) {
  const trimmed = text.trim();
  // Ends with a question mark, or known CTA phrases
  return /\?$/.test(trimmed) ||
    /which\s+one\?|let\s+me\s+know|want\s+me\s+to|would\s+you\s+like|what\s+do\s+you|reply\s+with|choose|pick\s+one|ready\s+to/i.test(trimmed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply all Dona personality rules to a raw message.
 *
 * Processing order:
 *  1. Strip filler openers ("Great!", "Sure!", etc.)
 *  2. Fix ALL CAPS words (leave single-word emphasis, convert multiples)
 *  3. Enforce emoji limit (≤ 2)
 *  4. Enforce 200-word limit
 *  5. Ensure message ends with a CTA / question
 *
 * @param {string}  rawMessage  - The raw response from a module
 * @param {object}  [context]   - Optional context (unused currently, reserved)
 * @returns {string} Personality-enforced message
 */
function formatMessage(rawMessage, context = {}) {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return rawMessage;
  }

  let msg = rawMessage;

  // Step 1 — Remove filler openers
  msg = stripFillers(msg);

  // Step 2 — Fix ALL CAPS words
  msg = fixAllCaps(msg);

  // Step 3 — Limit emoji to 2
  if (countEmoji(msg) > MAX_EMOJI) {
    msg = limitEmoji(msg, MAX_EMOJI);
    logger.debug('Personality: emoji capped at 2');
  }

  // Step 4 — Enforce 200-word limit
  if (wordCount(msg) > MAX_WORDS) {
    logger.debug(`Personality: truncating message (${wordCount(msg)} words → ${MAX_WORDS})`);
    msg = truncateToWordLimit(msg, MAX_WORDS);
  }

  // Step 5 — Ensure CTA / question at the end
  if (!hasCTA(msg)) {
    msg = msg.trimEnd() + '\n' + DEFAULT_CTA;
  }

  return msg.trim();
}

/**
 * Format 2–3 options as a numbered list with tradeoffs (PRD Section 13.2).
 *
 * @param {Array<{ name: string, detail?: string, tradeoff?: string, mapsLink?: string }>} options
 * @returns {string} Formatted message
 */
function formatOptions(options) {
  if (!options || options.length === 0) {
    return 'No options available right now. Want me to try a different search?';
  }

  const capped = options.slice(0, 3);
  const lines  = [];

  capped.forEach((opt, i) => {
    const detail    = opt.detail    ? ` — ${opt.detail}`    : '';
    const tradeoff  = opt.tradeoff  ? `\n   ↳ ${opt.tradeoff}` : '';
    const mapsLink  = opt.mapsLink  ? `\n   📍 ${opt.mapsLink}` : '';
    lines.push(`${i + 1}. ${opt.name}${detail}${tradeoff}${mapsLink}`);
  });

  lines.push('');
  lines.push('Which one?');

  return formatMessage(lines.join('\n'));
}

/**
 * Format a proactive alert message: concise, actionable, ends with question.
 *
 * @param {string} alertText - Raw alert content
 * @returns {string} Formatted alert
 */
function formatAlert(alertText) {
  if (!alertText) return '';
  // Alerts must be short by design; run through personality filter
  return formatMessage(alertText);
}

/**
 * Return the standard conflict response when family members disagree.
 * (PRD Section 13.3, 19.6)
 *
 * @returns {string}
 */
function formatConflictResponse() {
  return "Seeing different votes — let me know when you've decided!";
}

/**
 * Format an error-recovery message when a suggestion didn't work out.
 * (PRD Section 13.4)
 *
 * @param {string|{ name: string }} failedOption   - The option that failed
 * @param {object}                  nextBestOption  - The alternative to show
 * @returns {string}
 */
function formatErrorRecovery(failedOption, nextBestOption) {
  const failedName = typeof failedOption === 'string'
    ? failedOption
    : (failedOption?.name || 'that place');

  const altName    = nextBestOption?.name || 'the next option';
  const altDetail  = nextBestOption?.detail
    ? ` — ${nextBestOption.detail}`
    : '';
  const altTradeoff = nextBestOption?.tradeoff
    ? `\n↳ ${nextBestOption.tradeoff}`
    : '';
  const altLink    = nextBestOption?.mapsLink
    ? `\n📍 ${nextBestOption.mapsLink}`
    : '';

  const msg = `Oops, ${failedName} didn't work out. Here's the next best option:\n` +
    `${altName}${altDetail}${altTradeoff}${altLink}`;

  return formatMessage(msg);
}

/**
 * Express uncertainty about place data (PRD Section 14.1 — honest about uncertainty).
 *
 * @param {string} thing - Name of the place or piece of information
 * @returns {string}
 */
function formatUncertainty(thing) {
  const name = thing || 'this place';
  return `Google shows ${name} as open, but hours might have changed — maybe call ahead.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  formatMessage,
  formatOptions,
  formatAlert,
  formatConflictResponse,
  formatErrorRecovery,
  formatUncertainty,
  // Exported for unit testing
  stripFillers,
  fixAllCaps,
  limitEmoji,
  countEmoji,
  wordCount,
  truncateToWordLimit,
  hasCTA,
};
