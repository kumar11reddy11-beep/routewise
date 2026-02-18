'use strict';

/**
 * RouteWise Logger
 * Simple leveled logger with [RouteWise] prefix and ISO timestamps.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function format(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
  return `[RouteWise] [${ts}] [${level.toUpperCase()}] ${msg}`;
}

function debug(...args) {
  if (currentLevel <= LEVELS.debug) console.debug(format('debug', ...args));
}

function info(...args) {
  if (currentLevel <= LEVELS.info) console.info(format('info', ...args));
}

function warn(...args) {
  if (currentLevel <= LEVELS.warn) console.warn(format('warn', ...args));
}

function error(...args) {
  if (currentLevel <= LEVELS.error) console.error(format('error', ...args));
}

module.exports = { debug, info, warn, error };
