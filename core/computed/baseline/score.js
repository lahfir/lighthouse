/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Calculates Baseline readiness score
 */

/** @typedef {import('./webstatus-client.js').BaselineStatus} BaselineStatus */
/** @typedef {import('./tokens.js').Token} Token */

/**
 * @typedef {{
 *   feature_id: string,
 *   status: string,
 *   low_date?: string,
 *   high_date?: string,
 *   where?: string,
 *   weight?: number,
 *   isCore?: boolean
 * }} BaselineRow
 */

/**
 * @typedef {{
 *   score01: number,
 *   numeric100: number,
 *   rows: BaselineRow[],
 *   warnings: string[]
 * }} BaselineScore
 */

/**
 * Calculate usage weight from coverage data with improved logic
 * @param {string} featureId
 * @param {Object} coverageData
 * @param {Token[]} tokens
 * @return {number} Weight between 0.3 and 2.0
 */
function calculateUsageWeight(featureId, coverageData, tokens) {
  // Base weight depends on feature criticality
  let weight = isCoreFeature(featureId) ? 1.2 : 1.0;

  // Count actual token occurrences for this feature
  // Ensure featureId is a string before calling toLowerCase()
  const featureIdStr = String(featureId || '').toLowerCase();
  const tokenCount = tokens.filter(
    (token) =>
      token.token.toLowerCase().includes(featureIdStr) ||
      featureIdStr.includes(token.token.toLowerCase())
  ).length;

  // Adjust weight based on usage frequency
  if (tokenCount > 50) {
    weight *= 1.8; // Very high usage
  } else if (tokenCount > 20) {
    weight *= 1.5; // High usage
  } else if (tokenCount > 5) {
    weight *= 1.2; // Medium usage
  } else if (tokenCount === 1) {
    weight *= 0.7; // Single use
  } else if (tokenCount === 0) {
    weight *= 0.3; // Detected but unused (possibly polyfilled)
  }

  // If we have actual coverage data, incorporate it
  if (coverageData && coverageData[featureId]) {
    const usage = coverageData[featureId];
    const coverageMultiplier = Math.min(
      Math.max(usage.frequency / 10, 0.5),
      1.5
    );
    weight *= coverageMultiplier;
  }

  return Math.min(Math.max(weight, 0.3), 2.0);
}

/**
 * Get points for baseline status with enhanced scoring
 * @param {string} status
 * @param {boolean} isCore - Whether this is a core web platform feature
 * @return {number}
 */
function getStatusPoints(status, isCore = false) {
  switch (status) {
    case "widely":
      return 3; // Increased for better discrimination
    case "newly":
      return isCore ? 1.5 : 2; // Core features penalized less for being newly available
    case "limited":
      return isCore ? -1 : 0; // Core features with limited support penalized
    case "unknown":
    default:
      return 0;
  }
}

/**
 * Determine if a feature is considered core web platform
 * @param {string} featureId
 * @return {boolean}
 */
function isCoreFeature(featureId) {
  const coreFeatures = new Set([
    "fetch",
    "abortable-fetch",
    "promises",
    "async-await",
    "grid",
    "flexbox",
    "custom-properties",
    "es6-module",
    "arrow-functions",
    "const-let",
    "websockets",
    "xhr",
    "dom-manipulation",
    "forms",
    "semantic-html",
    "accessibility",
  ]);

  return coreFeatures.has(featureId);
}

/**
 * Calculate progressive enhancement bonus
 * @param {Map<string, BaselineStatus>} featureStatuses
 * @return {number}
 */
function calculateProgressiveEnhancementBonus(featureStatuses) {
  let coreCount = 0;
  let coreWidelySupported = 0;
  let enhancementCount = 0;
  let enhancementAppropriate = 0;

  for (const [featureId, status] of featureStatuses) {
    if (isCoreFeature(featureId)) {
      coreCount++;
      if (status.status === "widely") {
        coreWidelySupported++;
      }
    } else {
      enhancementCount++;
      // Enhancement features are appropriate if they're newly/widely supported
      // or if they're limited but used sparingly
      if (status.status === "newly" || status.status === "widely") {
        enhancementAppropriate++;
      }
    }
  }

  // Bonus for good progressive enhancement practices
  let bonus = 0;
  if (coreCount > 0) {
    const coreRatio = coreWidelySupported / coreCount;
    if (coreRatio >= 0.9) bonus += 0.1; // 10% bonus for solid core
  }

  if (enhancementCount > 0) {
    const enhancementRatio = enhancementAppropriate / enhancementCount;
    if (enhancementRatio >= 0.8) bonus += 0.05; // 5% bonus for good enhancement choices
  }

  return Math.min(bonus, 0.15); // Cap at 15% bonus
}

/**
 * Format date string for display
 * @param {string=} dateStr
 * @return {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return "";

  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Find all locations where feature is used and return data for expandable source locations
 * @param {string} featureId
 * @param {Token[]} tokens
 * @param {Map<string, string>} tokenToFeatureMap
 * @return {{url: string, subItems?: {items: Array<{location: LH.Audit.Details.SourceLocationValue}>}}}
 */
function findFeatureLocation(featureId, tokens, tokenToFeatureMap) {
  // Find all tokens that map to this feature
  const featureTokens = tokens.filter(token => 
    tokenToFeatureMap.get(token.token) === featureId
  );

  if (featureTokens.length === 0) {
    return { url: "Various" };
  }

  // Group by source file
  const locationsByFile = new Map();
  
  for (const token of featureTokens) {
    if (token.location) {
      if (!locationsByFile.has(token.location)) {
        locationsByFile.set(token.location, []);
      }
      locationsByFile.get(token.location).push({
        location: {
          type: 'source-location',
          url: token.location,
          urlProvider: 'network',
          line: token.line || 0,
          column: token.column || 0,
        }
      });
    }
  }

  if (locationsByFile.size === 0) {
    return { url: "Various" };
  }

  // Use the first file as the main URL and all locations as sub-items
  const firstFile = Array.from(locationsByFile.keys())[0];
  const allLocations = Array.from(locationsByFile.values()).flat();

  return {
    url: firstFile,
    subItems: {
      items: allLocations
    }
  };
}

/**
 * Calculate Baseline readiness score with enhanced algorithm
 * @param {Map<string, BaselineStatus>} featureStatuses
 * @param {Token[]} tokens
 * @param {Map<string, string>} tokenToFeatureMap
 * @param {Object=} usageData Optional usage/coverage data
 * @return {BaselineScore}
 */
function calculateScore(featureStatuses, tokens, tokenToFeatureMap, usageData) {
  const rows = [];
  const warnings = [];

  let totalPoints = 0;
  let maxPoints = 0;
  let limitedFeatureCount = 0;
  let coreFeatureCount = 0;

  // Process each feature
  for (const [featureId, status] of featureStatuses) {
    const isCore = isCoreFeature(featureId);
    const weight = calculateUsageWeight(featureId, usageData, tokens);
    const points = getStatusPoints(status.status, isCore);
    const weightedPoints = points * weight;

    totalPoints += weightedPoints;
    maxPoints += 3 * weight; // Max is now 3 points per feature

    if (status.status === "limited") {
      limitedFeatureCount++;
    }
    if (isCore) {
      coreFeatureCount++;
    }

    // Build row for details table
    rows.push({
      feature_id: featureId,
      status: status.status,
      low_date: formatDate(status.low_date),
      high_date: formatDate(status.high_date),
      where: findFeatureLocation(featureId, tokens, tokenToFeatureMap),
      weight: weight !== 1.0 ? weight : undefined,
      isCore: isCore || undefined, // Only show if true
    });
  }

  // Apply progressive enhancement bonus
  const progressiveBonus =
    calculateProgressiveEnhancementBonus(featureStatuses);

  // Calculate base score
  let score01 = maxPoints > 0 ? totalPoints / maxPoints : 1;

  // Apply progressive enhancement bonus
  score01 = Math.min(score01 + progressiveBonus, 1.0);

  // Penalty for excessive use of limited features
  const limitedRatio =
    featureStatuses.size > 0 ? limitedFeatureCount / featureStatuses.size : 0;
  if (limitedRatio > 0.3) {
    score01 *= 0.8; // 20% penalty if >30% features are limited
    warnings.push(
      "High usage of features with limited browser support detected"
    );
  }

  // Sort rows by priority: core limited features first, then by status impact
  rows.sort((a, b) => {
    // Prioritize core features with issues
    if (a.isCore && !b.isCore && a.status === "limited") return -1;
    if (b.isCore && !a.isCore && b.status === "limited") return 1;

    // Then sort by status impact (limited first as they need attention)
    const statusOrder = { limited: 0, unknown: 1, newly: 2, widely: 3 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;

    // Finally by weight (higher impact first)
    return (b.weight || 1) - (a.weight || 1);
  });

  const numeric100 = Math.round(score01 * 100);

  // Enhanced warnings
  if (featureStatuses.size === 0) {
    warnings.push("No Web Platform features detected");
  }

  const unknownCount = Array.from(featureStatuses.values()).filter(
    (s) => s.status === "unknown"
  ).length;
  if (unknownCount > 0) {
    warnings.push(
      `Unable to determine Baseline status for ${unknownCount} features`
    );
  }

  if (coreFeatureCount === 0 && featureStatuses.size > 0) {
    warnings.push(
      "Consider using well-established web platform features for better compatibility"
    );
  }

  return {
    score01,
    numeric100,
    rows,
    warnings,
  };
}

/**
 * Generate summary statistics
 * @param {BaselineRow[]} rows
 * @return {{widely: number, newly: number, limited: number, unknown: number}}
 */
function generateSummaryStats(rows) {
  const stats = {
    widely: 0,
    newly: 0,
    limited: 0,
    unknown: 0,
  };

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(stats, row.status)) {
      stats[row.status]++;
    }
  }

  return stats;
}

export { calculateScore, generateSummaryStats };
export default { calculateScore, generateSummaryStats };
