/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Baseline budget management for CI gating
 */

import fs from 'fs';
import path from 'path';

/**
 * @typedef {{
 *   minScore?: number,
 *   forbidLimited?: boolean,
 *   allowUnknown?: boolean,
 *   perRoute?: Record<string, {minScore?: number, forbidLimited?: boolean}>
 * }} BaselineBudget
 */

/**
 * @typedef {{
 *   violated: boolean,
 *   reasons: string[]
 * }} BudgetEvaluation
 */

/**
 * Load baseline budgets from settings or filesystem
 * @param {{settings: LH.Config.Settings, mainDocumentUrl?: string}} options
 * @return {BaselineBudget}
 */
function loadBudgets({settings}) {
  // Prefer settings if provided
  if (settings?.baselineBudgets) {
    return normalizePolicy(settings.baselineBudgets);
  }

  // Try to load from filesystem (only in CLI environment)
  if (typeof process !== 'undefined' && process.cwd) {
    try {
      const budgetPath = path.join(process.cwd(), 'baseline.budgets.json');
      if (fs.existsSync(budgetPath)) {
        const content = fs.readFileSync(budgetPath, 'utf8');
        const policy = JSON.parse(content);
        return normalizePolicy(policy);
      }
    } catch (err) {
      // Silently fail, use defaults
    }
  }

  // Return defaults
  return normalizePolicy({});
}

/**
 * Normalize and validate budget policy
 * @param {any} policy
 * @return {BaselineBudget}
 */
function normalizePolicy(policy) {
  const normalized = {
    minScore: typeof policy.minScore === 'number' ?
      Math.max(0, Math.min(1, policy.minScore)) : undefined,
    forbidLimited: Boolean(policy.forbidLimited),
    allowUnknown: policy.allowUnknown !== false, // Default true
    perRoute: {},
  };

  // Normalize per-route policies
  if (policy.perRoute && typeof policy.perRoute === 'object') {
    for (const [route, routePolicy] of Object.entries(policy.perRoute)) {
      if (typeof routePolicy === 'object') {
        normalized.perRoute[route] = {
          minScore: typeof routePolicy.minScore === 'number' ?
            Math.max(0, Math.min(1, routePolicy.minScore)) : undefined,
          forbidLimited: Boolean(routePolicy.forbidLimited),
        };
      }
    }
  }

  return normalized;
}

/**
 * Determine the route from a URL
 * @param {string} url
 * @return {string}
 */
function getRouteFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return '/';
  }
}

/**
 * Evaluate budget violations
 * @param {{
 *   policy: BaselineBudget,
 *   route: string,
 *   score01: number,
 *   rows: Array<{status: string}>
 * }} options
 * @return {BudgetEvaluation}
 */
function evaluateBudgets({policy, route, score01, rows}) {
  const reasons = [];
  let violated = false;

  // Get effective policy (merge global and per-route)
  const routePolicy = policy.perRoute?.[route] || {};
  const effectivePolicy = {
    minScore: routePolicy.minScore ?? policy.minScore,
    forbidLimited: routePolicy.forbidLimited ?? policy.forbidLimited,
    allowUnknown: policy.allowUnknown,
  };

  // Check minimum score
  if (effectivePolicy.minScore !== undefined && score01 < effectivePolicy.minScore) {
    violated = true;
    const scorePercent = Math.round(score01 * 100);
    const minPercent = Math.round(effectivePolicy.minScore * 100);
    reasons.push(`score ${scorePercent}% < ${minPercent}%`);
  }

  // Check for limited features
  const hasLimited = rows.some(r => r.status === 'limited');
  if (effectivePolicy.forbidLimited && hasLimited) {
    violated = true;
    const limitedCount = rows.filter(r => r.status === 'limited').length;
    reasons.push(`${limitedCount} limited feature${limitedCount > 1 ? 's' : ''} present`);
  }

  // Check for unknown features
  const hasUnknown = rows.some(r => r.status === 'unknown');
  if (!effectivePolicy.allowUnknown && hasUnknown) {
    violated = true;
    const unknownCount = rows.filter(r => r.status === 'unknown').length;
    reasons.push(`${unknownCount} unknown feature${unknownCount > 1 ? 's' : ''} present`);
  }

  // Add route context to reasons if applicable
  if (violated && route !== '/' && routePolicy.minScore !== undefined) {
    reasons[reasons.length - 1] += ` on route ${route}`;
  }

  return {violated, reasons};
}

export {loadBudgets, evaluateBudgets, getRouteFromUrl};
export default {loadBudgets, evaluateBudgets, getRouteFromUrl};
