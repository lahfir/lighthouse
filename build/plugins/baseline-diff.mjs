#!/usr/bin/env node
/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Compares two Lighthouse reports for Baseline feature changes
 * Usage: node build/plugins/baseline-diff.mjs base.json head.json
 */

import fs from 'fs';
import path from 'path';

/**
 * Load and parse LHR JSON file
 * @param {string} filepath
 * @return {Object}
 */
function loadLHR(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to load ${filepath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Extract baseline audit data from LHR
 * @param {Object} lhr
 * @return {Object|null}
 */
function extractBaselineData(lhr) {
  const audit = lhr?.audits?.['baseline-readiness'];
  if (!audit || !audit.details || !audit.details.items) {
    return null;
  }

  return {
    score: audit.score,
    numericValue: audit.numericValue,
    items: audit.details.items,
  };
}

/**
 * Build feature map from items
 * @param {Array} items
 * @return {Map<string, Object>}
 */
function buildFeatureMap(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.feature_id, {
      status: item.status?.toLowerCase(),
      weight: item.weight || 1.0,
    });
  }
  return map;
}

/**
 * Find newly limited features
 * @param {Map} baseMap
 * @param {Map} headMap
 * @return {Array}
 */
function findNewLimited(baseMap, headMap) {
  const newLimited = [];
  for (const [featureId, headData] of headMap) {
    const baseData = baseMap.get(featureId);
    if (headData.status === 'limited' && (!baseData || baseData.status !== 'limited')) {
      newLimited.push({
        feature_id: featureId,
        where: 'New in head',
      });
    }
  }
  return newLimited;
}

/**
 * Find feature downgrades
 * @param {Map} baseMap
 * @param {Map} headMap
 * @return {Array}
 */
function findDowngrades(baseMap, headMap) {
  const downgrades = [];
  const statusRank = {'widely': 3, 'newly': 2, 'limited': 1, 'unknown': 0};

  for (const [featureId, headData] of headMap) {
    const baseData = baseMap.get(featureId);
    if (baseData) {
      const baseRank = statusRank[baseData.status] || 0;
      const headRank = statusRank[headData.status] || 0;
      if (headRank < baseRank) {
        downgrades.push({
          feature_id: featureId,
          from: baseData.status,
          to: headData.status,
        });
      }
    }
  }
  return downgrades;
}

/**
 * Find top contributing features to score change
 * @param {Map} baseMap
 * @param {Map} headMap
 * @param {number} limit
 * @return {Array}
 */
function findTopContributors(baseMap, headMap, limit = 5) {
  const contributors = [];
  const statusPoints = {'widely': 2, 'newly': 1, 'limited': 0, 'unknown': 0};

  for (const [featureId, headData] of headMap) {
    const baseData = baseMap.get(featureId);
    const basePoints = baseData ?
      statusPoints[baseData.status] * (baseData.weight || 1.0) : 0;
    const headPoints = statusPoints[headData.status] * (headData.weight || 1.0);
    const delta = headPoints - basePoints;

    if (Math.abs(delta) > 0.001) {
      contributors.push({
        feature_id: featureId,
        delta: delta,
      });
    }
  }

  // Sort by absolute delta and take top N
  contributors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return contributors.slice(0, limit);
}

/**
 * Main diff function
 * @param {string} basePath
 * @param {string} headPath
 */
function main(basePath, headPath) {
  console.log('Loading base report:', basePath);
  const baseLHR = loadLHR(basePath);
  const baseData = extractBaselineData(baseLHR);

  console.log('Loading head report:', headPath);
  const headLHR = loadLHR(headPath);
  const headData = extractBaselineData(headLHR);

  if (!baseData || !headData) {
    console.error('Baseline audit not found in one or both reports');
    process.exit(1);
  }

  const baseMap = buildFeatureMap(baseData.items);
  const headMap = buildFeatureMap(headData.items);

  // Calculate diffs
  const scoreDelta = (headData.score - baseData.score);
  const newLimited = findNewLimited(baseMap, headMap);
  const downgrades = findDowngrades(baseMap, headMap);
  const topContributors = findTopContributors(baseMap, headMap);

  // Create diff result
  const diff = {
    scoreDelta: Number(scoreDelta.toFixed(3)),
    newLimited,
    downgrades,
    topContributors,
  };

  // Print to console
  console.log('\n=== Baseline Diff Summary ===');
  console.log(`Score change: ${diff.scoreDelta > 0 ? '+' : ''}${(diff.scoreDelta * 100).toFixed(1)}%`);

  if (newLimited.length > 0) {
    console.log(`\nNew limited features (${newLimited.length}):`);
    for (const feature of newLimited) {
      console.log(`  - ${feature.feature_id}`);
    }
  }

  if (downgrades.length > 0) {
    console.log(`\nDowngraded features (${downgrades.length}):`);
    for (const downgrade of downgrades) {
      console.log(`  - ${downgrade.feature_id}: ${downgrade.from} → ${downgrade.to}`);
    }
  }

  if (topContributors.length > 0) {
    console.log('\nTop score contributors:');
    for (const contrib of topContributors) {
      const sign = contrib.delta > 0 ? '+' : '';
      console.log(`  - ${contrib.feature_id}: ${sign}${contrib.delta.toFixed(3)}`);
    }
  }

  // Write diff to file
  const outputPath = headPath.replace(/\.json$/, '') + '-baseline-diff.json';
  fs.writeFileSync(outputPath, JSON.stringify(diff, null, 2));
  console.log(`\nDiff written to: ${outputPath}`);
}

// CLI execution
if (process.argv.length !== 4) {
  console.error('Usage: node baseline-diff.mjs base.json head.json');
  process.exit(1);
}

main(process.argv[2], process.argv[3]);