#!/usr/bin/env node
/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Generates token→feature_id mapping from web-features dataset
 * Source: https://github.com/web-platform-dx/web-features
 *
 * Usage:
 *   node core/scripts/baseline/update-feature-map.mjs [--full]
 *   yarn baseline-update-map
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {{
 *   name: string,
 *   feature_id: string,
 *   spec?: Array<{url: string}>,
 *   compat_features?: string[],
 *   status?: {baseline?: string}
 * }} WebFeature
 */

/**
 * Load web-features data from npm package
 * @return {Map<string, WebFeature>}
 */
function loadWebFeatures() {
  console.log('Loading web-features from npm package');

  // Read the JSON file from node_modules
  const packagePath = path.resolve(__dirname, '../../../node_modules/web-features/index.json');
  const webFeaturesData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  const features = new Map();

  for (const [id, feature] of Object.entries(webFeaturesData)) {
    features.set(id, {...feature, feature_id: id});
  }

  console.log(`Loaded ${features.size} features from web-features package`);
  return features;
}

/**
 * Extract tokens from compat_features strings using BCD key patterns
 * @param {string} compatStr
 * @return {Set<string>}
 */
function extractTokensFromCompat(compatStr) {
  const tokens = new Set();

  // CSS properties: css.properties.grid-template-columns
  if (compatStr.startsWith('css.properties.')) {
    const prop = compatStr.replace('css.properties.', '');
    tokens.add(prop);

    // Add shorthand variants (grid-template-columns → grid-template, grid)
    const parts = prop.split('-');
    for (let i = 1; i < parts.length; i++) {
      tokens.add(parts.slice(0, i).join('-'));
    }

    // Special handling for vendor prefixes
    if (prop.startsWith('-webkit-') || prop.startsWith('-moz-') ||
        prop.startsWith('-ms-') || prop.startsWith('-o-')) {
      const unprefixed = prop.replace(/^-\w+-/, '');
      tokens.add(unprefixed);
    }
  }

  // CSS at-rules: css.at-rules.container
  if (compatStr.startsWith('css.at-rules.')) {
    const rule = compatStr.replace('css.at-rules.', '');
    tokens.add(`@${rule}`);
  }

  // CSS selectors: css.selectors.has
  if (compatStr.startsWith('css.selectors.')) {
    const selector = compatStr.replace('css.selectors.', '');

    // Handle pseudo-classes and pseudo-elements
    if (selector.includes('pseudo')) {
      // Extract actual selector name
      const match = selector.match(/^([^_]+)/);
      if (match) {
        tokens.add(`:${match[1]}`);
        tokens.add(`::${match[1]}`); // Also pseudo-element form
      }
    } else {
      tokens.add(`:${selector}`);
      tokens.add(`::${selector}`);
    }
  }

  // CSS types and values: css.types.color.oklch
  if (compatStr.startsWith('css.types.')) {
    const type = compatStr.replace('css.types.', '');
    const parts = type.split('.');
    tokens.add(parts[parts.length - 1]); // Add the final part (e.g., oklch)
  }

  // HTML elements: html.elements.dialog
  if (compatStr.startsWith('html.elements.')) {
    const elem = compatStr.replace('html.elements.', '');
    tokens.add(elem);
  }

  // HTML global attributes: html.global_attributes.popover
  if (compatStr.startsWith('html.global_attributes.')) {
    const attr = compatStr.replace('html.global_attributes.', '');
    tokens.add(attr);
    tokens.add(`loading-${attr}`); // Special case for loading attributes
  }

  // HTML element attributes: html.elements.img.loading
  if (compatStr.match(/^html\.elements\.\w+\./)) {
    const parts = compatStr.split('.');
    if (parts.length >= 4) {
      const attr = parts[3];
      tokens.add(attr);

      // Special handling for loading attributes
      if (attr === 'loading') {
        tokens.add('loading-lazy');
        tokens.add('loading-eager');
      }
    }
  }

  // JavaScript Web APIs: api.Navigator.clipboard
  if (compatStr.startsWith('api.')) {
    const apiPath = compatStr.replace('api.', '');
    const parts = apiPath.split('.');

    // Add the full API path and individual parts
    tokens.add(apiPath);
    tokens.add(apiPath.toLowerCase());

    // Add constructor patterns
    if (parts.length >= 2) {
      tokens.add(parts[0]); // Navigator
      tokens.add(parts[1]); // clipboard
      tokens.add(`${parts[0]}.${parts[1]}`); // Navigator.clipboard
      tokens.add(`new ${parts[parts.length - 1]}`); // For constructors
    }

    // Add prototype patterns for methods
    if (parts.length >= 3) {
      tokens.add(`${parts[0]}.prototype.${parts[2]}`);
    }
  }

  // JavaScript built-ins: javascript.builtins.Array.at
  if (compatStr.startsWith('javascript.builtins.')) {
    const builtin = compatStr.replace('javascript.builtins.', '');
    const parts = builtin.split('.');

    tokens.add(builtin);
    if (parts.length >= 2) {
      tokens.add(`${parts[0]}.${parts[1]}`); // Array.at
      tokens.add(`${parts[0]}.prototype.${parts[1]}`); // Array.prototype.at
      tokens.add(parts[1]); // at (method name)
    }
  }

  // JavaScript statements and grammar: javascript.statements.async_function
  if (compatStr.startsWith('javascript.statements.')) {
    const statement = compatStr.replace('javascript.statements.', '');
    if (statement === 'async_function') {
      tokens.add('async function');
      tokens.add('async');
    }
    tokens.add(statement.replace('_', ' '));
  }

  // JavaScript operators: javascript.operators.await
  if (compatStr.startsWith('javascript.operators.')) {
    const operator = compatStr.replace('javascript.operators.', '');
    tokens.add(operator);
    if (operator === 'await') {
      tokens.add('await ');
    }
  }

  // WebDriver BiDi: webdriver.bidi.*
  if (compatStr.startsWith('webdriver.')) {
    const parts = compatStr.split('.');
    if (parts.length >= 2) {
      tokens.add(parts[1]); // bidi
    }
  }

  // HTTP headers: http.headers.*
  if (compatStr.startsWith('http.headers.')) {
    const header = compatStr.replace('http.headers.', '');
    tokens.add(header.toLowerCase());
    tokens.add(header.replace(/-/g, '_')); // Alternative naming
  }

  return tokens;
}

/**
 * Get the web-features package version/commit
 * @return {string}
 */
function getMapVersion() {
  try {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../node_modules/web-features/package.json'
    );
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Build token→feature_id mapping
 * @param {Map<string, WebFeature>} features
 * @param {boolean} full
 * @return {Object}
 */
function buildTokenMap(features, full) {
  const tokenMap = {};
  const cssPatterns = [];
  const jsPatterns = [];

  for (const [featureId, feature] of features) {
    if (!feature.compat_features) continue;

    for (const compatStr of feature.compat_features) {
      const tokens = extractTokensFromCompat(compatStr);
      for (const token of tokens) {
        if (!tokenMap[token]) {
          tokenMap[token] = featureId;
        }
      }
    }
  }

  // Add pattern matching for CSS property families
  cssPatterns.push({regex: '^grid-', feature: 'grid'});
  cssPatterns.push({regex: '^flex-', feature: 'flexbox'});
  cssPatterns.push({regex: '^transform', feature: 'transforms2d'});
  cssPatterns.push({regex: '^animation-', feature: 'animations'});
  cssPatterns.push({regex: '^transition-', feature: 'transitions'});

  // Add pattern matching for JS API families
  jsPatterns.push({regex: '^WebGL', feature: 'webgl'});
  jsPatterns.push({regex: '^WebRTC', feature: 'webrtc'});
  jsPatterns.push({regex: '^Intl\\.', feature: 'intl'});

  const mapVersion = getMapVersion();

  // Limit size unless --full flag
  if (!full) {
    const entries = Object.entries(tokenMap);
    const limited = Object.fromEntries(entries.slice(0, 2000));
    return {
      tokens: limited,
      patterns: {css: cssPatterns, js: jsPatterns},
      mapVersion,
    };
  }

  return {
    tokens: tokenMap,
    patterns: {css: cssPatterns, js: jsPatterns},
    mapVersion,
  };
}

/**
 * Create seed mapping with core features
 * @return {Object}
 */
function createSeedMap() {
  return {
    tokens: {
      // CSS
      'grid': 'grid',
      'flex': 'flexbox',
      'transform': 'transforms2d',
      '@container': 'container-queries',
      ':has': 'has',
      ':where': 'where',
      ':is': 'is',

      // HTML
      'dialog': 'dialog',
      'popover': 'popover',
      'inert': 'inert',

      // JS
      'Promise': 'promises',
      'fetch': 'fetch',
      'IntersectionObserver': 'intersectionobserver',
      'ResizeObserver': 'resizeobserver',
      'Array.prototype.at': 'array-at',
      'structuredClone': 'structuredclone',
      'WebSocket': 'websockets',
      'Worker': 'workers',
    },
    patterns: {
      css: [{regex: '^grid-', feature: 'grid'}],
      js: [{regex: '^Intl\\.', feature: 'intl'}],
    },
    mapVersion: 'seed',
  };
}

function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');

  try {
    // Generate full map
    const features = loadWebFeatures();

    const tokenMap = buildTokenMap(features, full);
    const mapPath = path.join(__dirname, '../../../assets/baseline/feature-map.json');
    const mapDir = path.dirname(mapPath);

    if (!fs.existsSync(mapDir)) {
      fs.mkdirSync(mapDir, {recursive: true});
    }

    fs.writeFileSync(mapPath, JSON.stringify(tokenMap, null, 2));
    console.log(`Wrote ${Object.keys(tokenMap.tokens).length} token mappings to ${mapPath}`);

    // Always write seed map
    const seedMap = createSeedMap();
    const seedPath = path.join(__dirname, '../../../assets/baseline/feature-map.seed.json');
    fs.writeFileSync(seedPath, JSON.stringify(seedMap, null, 2));
    console.log(`Wrote seed map with ${Object.keys(seedMap.tokens).length} entries to ${seedPath}`);
  } catch (err) {
    console.error('Error updating feature map:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
