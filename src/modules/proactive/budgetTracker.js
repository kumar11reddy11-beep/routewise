'use strict';

const logger = require('../../utils/logger');

/**
 * RouteWise Budget Tracker (PRD Section 9)
 *
 * Tracks daily and trip-level spending across five categories:
 *   Gas | Food | Hotels | Activities | Misc
 *
 * Budget data lives in tripState.budget:
 *   { total, targets: {}, spent: {}, expenses: [] }
 *
 * Design principle (PRD §19.2): directional tracking, not exact accounting.
 * End-of-day prompts collect rough totals via a single consolidated ask.
 */

const VALID_CATEGORIES = ['gas', 'food', 'hotels', 'activities', 'misc'];

/**
 * Normalise a raw category string to a valid budget key.
 * Handles synonyms, abbreviations, and common typos.
 *
 * @param {string} raw
 * @returns {string} One of VALID_CATEGORIES
 */
function normaliseCategory(raw) {
  if (!raw) return 'misc';
  const lower = raw.toLowerCase().trim();

  if (VALID_CATEGORIES.includes(lower)) return lower;

  if (/gas|fuel|petrol|pump|station/.test(lower))                          return 'gas';
  if (/food|eat|lunch|dinner|breakfast|restaurant|cafe|dining|meal/.test(lower)) return 'food';
  if (/hotel|lodge|motel|room|accommodation|airbnb|inn|hostel/.test(lower)) return 'hotels';
  if (/activ|tour|museum|park|ticket|admission|entrance|hike|beach/.test(lower)) return 'activities';

  return 'misc';
}

/**
 * Ensure the budget sub-structure is initialised on the state object.
 * Mutates in place — safe to call multiple times.
 *
 * @param {object} state - Trip state reference
 */
function ensureBudgetStructure(state) {
  if (!state.budget) {
    state.budget = {
      total:    0,
      targets:  { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
      spent:    { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
      expenses: [],
    };
  }
  if (!state.budget.spent)    state.budget.spent    = {};
  if (!state.budget.expenses) state.budget.expenses = [];
  if (!state.budget.targets)  state.budget.targets  = {};

  VALID_CATEGORIES.forEach(c => {
    if (state.budget.spent[c]   == null) state.budget.spent[c]   = 0;
    if (state.budget.targets[c] == null) state.budget.targets[c] = 0;
  });
}

/**
 * Add an expense to tripState under the correct budget category.
 * Returns the updated (mutated) tripState for convenience.
 *
 * @param {object} tripState  - Full trip state (from memory/tripState.load())
 * @param {string} category   - 'gas' | 'food' | 'hotels' | 'activities' | 'misc' (or synonym)
 * @param {number} amount     - Dollar amount (positive)
 * @param {string} [note='']  - Optional description
 * @returns {object} Updated tripState
 */
function logExpense(tripState, category, amount, note = '') {
  ensureBudgetStructure(tripState);

  const cat = normaliseCategory(category);
  const amt = parseFloat(amount) || 0;

  tripState.budget.spent[cat] = (tripState.budget.spent[cat] || 0) + amt;

  tripState.budget.expenses.push({
    category: cat,
    amount:   amt,
    note:     note || '',
    loggedAt: new Date().toISOString(),
  });

  logger.info(`Expense logged: $${amt.toFixed(2)} on ${cat}${note ? ` — "${note}"` : ''}`);
  return tripState;
}

/**
 * Compute budget status across all categories.
 *
 * @param {object} tripState
 * @returns {{
 *   byCategory:      object,   // per-category breakdown
 *   totalSpent:      number,
 *   totalBudget:     number,
 *   remainingBudget: number,
 *   isOverBudget:    boolean,
 *   percentUsed:     number,
 * }}
 */
function getBudgetStatus(tripState) {
  const budget  = tripState?.budget || {};
  const spent   = budget.spent   || {};
  const targets = budget.targets || {};
  const total   = Number(budget.total) || 0;

  const totalSpent = VALID_CATEGORIES.reduce((sum, cat) => sum + (Number(spent[cat]) || 0), 0);

  const remainingBudget = total - totalSpent;
  const percentUsed     = total > 0 ? Math.round((totalSpent / total) * 100) : 0;
  const isOverBudget    = total > 0 && totalSpent > total;

  const byCategory = {};
  VALID_CATEGORIES.forEach(cat => {
    const catSpent  = Number(spent[cat])   || 0;
    const catTarget = Number(targets[cat]) || 0;
    byCategory[cat] = {
      spent:     catSpent,
      target:    catTarget,
      remaining: catTarget - catSpent,
      over:      catTarget > 0 && catSpent > catTarget,
    };
  });

  return {
    byCategory,
    totalSpent,
    totalBudget:     total,
    remainingBudget,
    isOverBudget,
    percentUsed,
  };
}

/**
 * Generate a Telegram-ready budget summary string.
 *
 * @param {object} tripState
 * @returns {string}
 */
function generateBudgetSummary(tripState) {
  const status = getBudgetStatus(tripState);
  const { byCategory, totalSpent, totalBudget, remainingBudget, percentUsed, isOverBudget } = status;

  const headerEmoji = isOverBudget ? '🔴' : percentUsed >= 80 ? '🟡' : '🟢';
  const remainStr   = remainingBudget >= 0
    ? `$${remainingBudget.toFixed(0)} remaining`
    : `$${Math.abs(remainingBudget).toFixed(0)} OVER budget`;

  const lines = [
    `${headerEmoji} Budget — ${percentUsed}% used`,
    `$${totalSpent.toFixed(0)} of $${totalBudget} total  (${remainStr})`,
    '',
    '📊 By category:',
  ];

  const catEmojis = {
    gas:        '⛽',
    food:       '🍽',
    hotels:     '🏨',
    activities: '🎯',
    misc:       '📦',
  };

  VALID_CATEGORIES.forEach(cat => {
    const { spent, target, over } = byCategory[cat];
    if (target === 0 && spent === 0) return; // Skip unconfigured, zero categories

    const emoji     = catEmojis[cat] || '💰';
    const overStr   = over ? ' ⚠️ over' : '';
    const targetStr = target > 0 ? `/$${target}` : '';
    const label     = cat.charAt(0).toUpperCase() + cat.slice(1);

    lines.push(`  ${emoji} ${label}: $${spent.toFixed(0)}${targetStr}${overStr}`);
  });

  return lines.join('\n');
}

/**
 * Assess whether the trip is over, on-track, or under budget.
 * Used by the intelligence layer to shift hotel/dining suggestions
 * (over → affordable options; under → suggest upgrades per PRD §9.3).
 *
 * @param {object} tripState
 * @returns {'over' | 'on-track' | 'under'}
 */
function getBudgetAwareness(tripState) {
  const { percentUsed, isOverBudget } = getBudgetStatus(tripState);

  if (isOverBudget || percentUsed > 100) return 'over';
  if (percentUsed >= 85)                 return 'on-track'; // Approaching limit
  if (percentUsed <= 60)                 return 'under';    // Well under — room for upgrades

  return 'on-track';
}

/**
 * Generate the end-of-day budget consolidation prompt (PRD §19.2).
 * Single consolidated ask at hotel arrival — not per-stop friction.
 *
 * @param {object} tripState
 * @returns {string}
 */
function endOfDayBudgetPrompt(tripState) {
  const { totalSpent, totalBudget, percentUsed } = getBudgetStatus(tripState);

  const headerEmoji = percentUsed > 100 ? '🔴' : percentUsed >= 80 ? '🟡' : '🟢';

  return [
    `${headerEmoji} Quick budget check!`,
    '',
    'Roughly how much did you spend today on:',
    '  ⛽ Gas?',
    '  🍽 Food?',
    '  🏨 Hotel?',
    '  🎯 Activities?',
    '',
    `(Trip total so far: $${totalSpent.toFixed(0)} of $${totalBudget} — ${percentUsed}% used)`,
    '',
    'Reply with "spent $X on [category]" for each.',
  ].join('\n');
}

module.exports = {
  logExpense,
  getBudgetStatus,
  generateBudgetSummary,
  getBudgetAwareness,
  endOfDayBudgetPrompt,
  normaliseCategory,   // Exported for testing
};
