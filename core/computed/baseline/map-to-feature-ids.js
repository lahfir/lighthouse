/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Maps extracted tokens to canonical feature IDs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @typedef {import('./tokens.js').Token} Token */

let featureMapCache = null;

/**
 * Load the feature map from disk
 * @return {{tokens: Object<string, string>, patterns: {css: Array, js: Array}, mapVersion?: string}}
 */
function loadFeatureMap() {
  if (featureMapCache) return featureMapCache;

  const mapPath = path.join(
    __dirname,
    "../../../assets/baseline/feature-map.json"
  );
  const seedPath = path.join(
    __dirname,
    "../../../assets/baseline/feature-map.seed.json"
  );

  try {
    // Try to load the full map first
    if (fs.existsSync(mapPath)) {
      const mapContent = fs.readFileSync(mapPath, "utf8");
      featureMapCache = JSON.parse(mapContent);
      return featureMapCache;
    }
  } catch (err) {
    // Fall through to seed map
  }

  try {
    // Fall back to seed map
    if (fs.existsSync(seedPath)) {
      const seedContent = fs.readFileSync(seedPath, "utf8");
      featureMapCache = JSON.parse(seedContent);
      return featureMapCache;
    }
  } catch (err) {
    // Use minimal embedded map
  }

  // Last resort: embedded minimal map
  featureMapCache = {
    tokens: {
      grid: "grid",
      flex: "flexbox",
      fetch: "fetch",
      Promise: "promises",
      IntersectionObserver: "intersectionobserver",
      dialog: "dialog",
      ":has": "has",
    },
    patterns: {
      css: [{ regex: "^grid-", feature: "grid" }],
      js: [{ regex: "^Intl\\.", feature: "intl" }],
    },
  };

  return featureMapCache;
}

/**
 * Apply pattern matching for tokens not found in direct mapping
 * @param {string} token
 * @param {string} type
 * @param {{css: Array, js: Array}} patterns
 * @return {string|null}
 */
function matchPattern(token, type, patterns) {
  const patternList =
    type === "css" ? patterns.css : type === "js" ? patterns.js : [];

  for (const pattern of patternList) {
    const regex = new RegExp(pattern.regex, "i");
    if (regex.test(token)) {
      return pattern.feature;
    }
  }

  return null;
}

/**
 * Normalize token for better matching
 * @param {string} token
 * @param {string} type
 * @return {string}
 */
function normalizeToken(token, type) {
  let normalized = token.toLowerCase().trim();

  if (type === "css") {
    // Remove vendor prefixes
    normalized = normalized.replace(/^-webkit-|-moz-|-ms-|-o-/, "");
    // Convert to kebab-case if needed
    normalized = normalized.replace(/_/g, "-");
  } else if (type === "js") {
    // Handle prototype access
    normalized = normalized.replace(".prototype.", ".");
    // Handle window/globalThis prefixes
    normalized = normalized.replace(/^window\.|^globalThis\./, "");
  }

  return normalized;
}

/**
 * Map tokens to feature IDs
 * @param {Token[]} tokens
 * @return {{ids: Set<string>, unresolved: Token[], mapVersion?: string}}
 */
function mapTokensToFeatureIds(tokens) {
  const featureMap = loadFeatureMap();
  const featureIds = new Set();
  const unresolved = [];

  for (const token of tokens) {
    const normalized = normalizeToken(token.token, token.type);

    // Direct lookup
    if (featureMap.tokens[normalized]) {
      featureIds.add(featureMap.tokens[normalized]);
      continue;
    }

    // Try without normalization
    if (featureMap.tokens[token.token]) {
      featureIds.add(featureMap.tokens[token.token]);
      continue;
    }

    // Pattern matching
    const patternMatch = matchPattern(
      normalized,
      token.type,
      featureMap.patterns
    );
    if (patternMatch) {
      featureIds.add(patternMatch);
      continue;
    }

    // Special handling for compound tokens
    if (token.type === "js" && normalized.includes(".")) {
      // Try base object (e.g., "Array.at" -> "Array")
      const base = normalized.split(".")[0];
      if (featureMap.tokens[base]) {
        featureIds.add(featureMap.tokens[base]);
        continue;
      }

      // Try full method (e.g., "Array.prototype.at" -> "array-at")
      const methodName = `${base}-${normalized.split(".").pop()}`;
      if (featureMap.tokens[methodName]) {
        featureIds.add(featureMap.tokens[methodName]);
        continue;
      }
    }

    // CSS property families
    if (token.type === "css" && normalized.includes("-")) {
      // Try base property (e.g., "grid-template-columns" -> "grid")
      const base = normalized.split("-")[0];
      if (featureMap.tokens[base]) {
        featureIds.add(featureMap.tokens[base]);
        continue;
      }
    }

    // Couldn't resolve
    unresolved.push(token);
  }

  return {
    ids: featureIds,
    unresolved,
    mapVersion: featureMap.mapVersion
  };
}

/**
 * Get a list of all known feature IDs for testing
 * @return {string[]}
 */
function getAllKnownFeatures() {
  const featureMap = loadFeatureMap();
  const features = new Set(Object.values(featureMap.tokens));

  // Add pattern features
  for (const pattern of featureMap.patterns.css) {
    features.add(pattern.feature);
  }
  for (const pattern of featureMap.patterns.js) {
    features.add(pattern.feature);
  }

  return Array.from(features);
}

export { mapTokensToFeatureIds, getAllKnownFeatures };
export default { mapTokensToFeatureIds, getAllKnownFeatures };
