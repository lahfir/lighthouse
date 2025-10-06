/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview User agent distribution and targeting for Baseline scoring
 */

import fs from 'fs';
import path from 'path';

/**
 * @typedef {{
 *   safari?: number,
 *   chrome?: number,
 *   firefox?: number,
 *   edge?: number
 * }} UADistribution
 */

/**
 * @typedef {{
 *   uaDistribution?: UADistribution
 * }} BaselineTargets
 */

/**
 * Load baseline targets from settings or filesystem
 * @param {{settings?: LH.Config.Settings}} options
 * @return {BaselineTargets}
 */
function loadTargets({settings}) {
  // Prefer settings if provided
  if (settings?.baselineTargets) {
    return normalizeTargets(settings.baselineTargets);
  }

  // Try to load from filesystem (only in CLI environment)
  if (typeof process !== 'undefined' && process.cwd) {
    try {
      const targetsPath = path.join(process.cwd(), 'baseline.targets.json');
      if (fs.existsSync(targetsPath)) {
        const content = fs.readFileSync(targetsPath, 'utf8');
        const targets = JSON.parse(content);
        return normalizeTargets(targets);
      }
    } catch (err) {
      // Silently fail, use defaults
    }
  }

  // Return defaults (equal distribution)
  return normalizeTargets({});
}

/**
 * Normalize UA distribution to sum to 1.0
 * @param {UADistribution} dist
 * @return {UADistribution}
 */
function normalizeUADistribution(dist) {
  const defaultDist = {
    safari: 0.25,
    chrome: 0.25,
    firefox: 0.25,
    edge: 0.25,
  };

  if (!dist || typeof dist !== 'object') {
    return defaultDist;
  }

  // Extract valid values
  const normalized = {};
  let sum = 0;

  for (const [browser, value] of Object.entries(dist)) {
    if (typeof value === 'number' && value >= 0) {
      normalized[browser] = value;
      sum += value;
    }
  }

  // If no valid values, return defaults
  if (sum === 0 || Object.keys(normalized).length === 0) {
    return defaultDist;
  }

  // Normalize to sum to 1.0
  for (const browser of Object.keys(normalized)) {
    normalized[browser] = normalized[browser] / sum;
  }

  // Fill missing browsers with 0
  for (const browser of ['safari', 'chrome', 'firefox', 'edge']) {
    if (!(browser in normalized)) {
      normalized[browser] = 0;
    }
  }

  return normalized;
}

/**
 * Normalize and validate targets
 * @param {any} targets
 * @return {BaselineTargets}
 */
function normalizeTargets(targets) {
  const normalized = {};

  if (targets?.uaDistribution) {
    normalized.uaDistribution = normalizeUADistribution(targets.uaDistribution);
  } else {
    // Default equal distribution
    normalized.uaDistribution = {
      safari: 0.25,
      chrome: 0.25,
      firefox: 0.25,
      edge: 0.25,
    };
  }

  return normalized;
}

/**
 * Calculate UA support factor based on browser support status
 * @param {string} status - 'widely', 'newly', 'limited', 'unknown'
 * @param {UADistribution} uaDistribution
 * @return {number} Factor between 0.5 and 1.0
 */
function uaSupportFactor(status, uaDistribution) {
  // Define support levels for each status
  // These represent the fraction of users who can use the feature
  const supportLevels = {
    widely: 1.0,   // All browsers support it
    newly: 0.8,    // Most browsers support it
    limited: 0.5,  // Limited browser support
    unknown: 0.7,  // Unknown, assume moderate support
  };

  const baseFactor = supportLevels[status] || 0.7;

  // Weight by UA distribution
  // For limited/newly, penalize based on likely unsupported browsers
  if (status === 'limited') {
    // Assume only Chrome/Edge support for limited features
    const chromeEdgeShare = (uaDistribution.chrome || 0) + (uaDistribution.edge || 0);
    // Factor is weighted average: supported browsers get 1.0, others get 0.5
    return Math.max(0.5, Math.min(1.0, 0.5 + chromeEdgeShare * 0.5));
  } else if (status === 'newly') {
    // Assume Safari is often the last to support
    const safariShare = uaDistribution.safari || 0;
    // Reduce factor based on Safari's market share
    return Math.max(0.5, Math.min(1.0, baseFactor - safariShare * 0.2));
  }

  return Math.max(0.5, Math.min(1.0, baseFactor));
}

export {loadTargets, uaSupportFactor, normalizeUADistribution};
export default {loadTargets, uaSupportFactor, normalizeUADistribution};