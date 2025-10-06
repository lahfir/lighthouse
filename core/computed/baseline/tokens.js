/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Extracts Web Platform feature tokens from Lighthouse artifacts
 */

/**
 * @typedef {{
 *   type: 'js' | 'css' | 'html',
 *   token: string,
 *   where?: {url: string, line?: number, column?: number},
 *   count?: number,
 *   route?: string,
 *   originType?: 'first-party' | 'vendor'
 * }} Token
 */

/**
 * Extract JavaScript tokens from Scripts artifact
 * @param {LH.Artifacts['Scripts']} scripts
 * @param {LH.Artifacts['JsUsage']=} jsUsage
 * @param {string=} finalUrl
 * @return {Token[]}
 */
function extractJavaScriptTokens(scripts, jsUsage, finalUrl) {
  const tokens = [];
  const tokenMap = new Map(); // Track locations and counts

  // Process script content if available
  if (scripts && scripts.length > 0) {
    for (const script of scripts) {
      if (!script.content) continue;

      const originType = determineOriginType(script.url, finalUrl);

      // Extract concrete JavaScript APIs and constructors
      const concretePatterns = [
        {pattern: /navigator\.(clipboard|geolocation|mediaDevices|serviceWorker|storage|webdriver)/g, extract: 1},
        {pattern: /document\.(querySelector|querySelectorAll|getElementById|createElement|cookie)/g, extract: 1},
        {pattern: /window\.(localStorage|sessionStorage|indexedDB|caches)/g, extract: 1},
        {pattern: /new\s+(IntersectionObserver|ResizeObserver|MutationObserver|PerformanceObserver)/g, extract: 1},
        {pattern: /new\s+(Worker|ServiceWorker|SharedWorker|WebSocket|WebAssembly)/g, extract: 1},
        {pattern: /new\s+(Map|Set|WeakMap|WeakSet|Proxy|URLSearchParams|URL|Blob|File)/g, extract: 1},
        {pattern: /Promise\.(all|race|resolve|reject|allSettled|any)/g, extract: 0},
        {pattern: /Array\.(from|of|isArray)/g, extract: 0},
        {pattern: /Object\.(keys|values|entries|assign|create|freeze|seal)/g, extract: 0},
        {pattern: /Intl\.(Collator|DateTimeFormat|NumberFormat|PluralRules)/g, extract: 1},
        {pattern: /crypto\.(subtle|getRandomValues)/g, extract: 1},
        {pattern: /fetch\s*\(/g, extract: 0},
        {pattern: /structuredClone\s*\(/g, extract: 0},
        {pattern: /import\s*\(/g, extract: 0},
      ];

      for (const {pattern, extract} of concretePatterns) {
        const matches = script.content.matchAll(pattern);
        for (const match of matches) {
          const token = extract > 0 ? match[extract] : match[0].replace(/[^\w.]/g, '');
          if (token) {
            const key = `js:${token.toLowerCase()}`;
            if (!tokenMap.has(key)) {
              // First occurrence - track location
              const position = getLineColumn(script.content, match.index);
              tokenMap.set(key, {
                type: 'js',
                token: token.toLowerCase(),
                where: {
                  url: script.url || 'inline',
                  line: position.line,
                  column: position.column,
                },
                count: 1,
                originType,
              });
            } else {
              // Subsequent occurrences - just increment count
              tokenMap.get(key).count++;
            }
          }
        }
      }

      // Extract specific concrete constructors that may not match patterns
      const additionalConstructors = [
        'AbortController', 'TextEncoder', 'TextDecoder', 'ReadableStream',
        'WritableStream', 'TransformStream', 'BroadcastChannel', 'MessageChannel',
        'customElements', 'FormData', 'Headers', 'Request', 'Response',
      ];

      for (const api of additionalConstructors) {
        if (script.content.includes(api)) {
          const key = `js:${api.toLowerCase()}`;
          if (!tokenMap.has(key)) {
            const index = script.content.indexOf(api);
            const position = getLineColumn(script.content, index);
            tokenMap.set(key, {
              type: 'js',
              token: api.toLowerCase(),
              where: {
                url: script.url || 'inline',
                line: position.line,
                column: position.column,
              },
              count: 1,
              originType,
            });
          } else {
            tokenMap.get(key).count++;
          }
        }
      }
    }
  }

  // Convert map to array and add route info
  for (const token of tokenMap.values()) {
    if (finalUrl) {
      token.route = getRouteFromUrl(finalUrl);
    }
    tokens.push(token);
  }

  return tokens;
}

/**
 * Extract CSS properties from actual used CSS rules
 * @param {LH.Artifacts['CSSUsage']=} cssUsage
 * @param {LH.Artifacts['Stylesheets']=} stylesheets
 * @param {string=} finalUrl
 * @return {Token[]}
 */
function extractCSSTokens(cssUsage, stylesheets, finalUrl) {
  const tokens = [];
  const tokenMap = new Map();

  if (!cssUsage || !stylesheets) {
    return tokens;
  }

  // Create stylesheet lookup
  const stylesheetsById = new Map();
  for (const stylesheet of stylesheets) {
    if (stylesheet.header?.styleSheetId) {
      stylesheetsById.set(stylesheet.header.styleSheetId, stylesheet);
    }
  }

  // Process only USED CSS rules for accuracy
  for (const rule of cssUsage) {
    if (!rule.used || !rule.styleSheetId) continue;

    const stylesheet = stylesheetsById.get(rule.styleSheetId);
    if (!stylesheet || !stylesheet.content) continue;

    // Extract the actual CSS rule text that was used
    const ruleText = stylesheet.content.substring(rule.startOffset, rule.endOffset);
    const sourceURL = stylesheet.header?.sourceURL;
    
    const originType = determineOriginType(sourceURL, finalUrl);

    // Parse concrete CSS properties and features from the used rule
    const features = extractCSSFeaturesFromRule(ruleText, stylesheet.content, rule);

    for (const feature of features) {
      const key = `css:${feature.token}`;
      if (!tokenMap.has(key)) {
        // Calculate line/column from offset
        const location = calculateLineColumn(stylesheet.content, rule.startOffset);

        tokenMap.set(key, {
          type: 'css',
          token: feature.token,
          where: {
            url: sourceURL || 'inline',
            line: location.line,
            column: location.column,
          },
          count: 1,
          originType,
        });
      } else {
        tokenMap.get(key).count++;
      }
    }
  }

  // Convert map to array and add route info
  for (const token of tokenMap.values()) {
    if (finalUrl) {
      token.route = getRouteFromUrl(finalUrl);
    }
    tokens.push(token);
  }

  return tokens;
}

/**
 * Extract concrete CSS features from a CSS rule
 * @param {string} ruleText
 * @param {string} fullContent
 * @param {Object} rule
 * @return {Array<{token: string}>}
 */
function extractCSSFeaturesFromRule(ruleText, fullContent, rule) {
  const features = [];
  const seen = new Set();

  // Extract concrete CSS properties
  const propertyMatches = ruleText.matchAll(/([a-z-]+)\s*:/gi);
  for (const match of propertyMatches) {
    const property = match[1].toLowerCase().trim();

    // Only include concrete, non-generic properties
    if (!seen.has(property) && isConcreteCSSProperty(property)) {
      seen.add(property);
      features.push({token: property});
    }
  }

  // Extract at-rules
  const atRuleMatches = ruleText.matchAll(/@([a-z-]+)/gi);
  for (const match of atRuleMatches) {
    const atRule = `@${match[1].toLowerCase()}`;
    if (!seen.has(atRule)) {
      seen.add(atRule);
      features.push({token: atRule});
    }
  }

  // Extract pseudo-classes and pseudo-elements
  const pseudoMatches = ruleText.matchAll(/:([:a-z-]+)/gi);
  for (const match of pseudoMatches) {
    const pseudo = `:${match[1].toLowerCase()}`;
    if (!seen.has(pseudo) && isConcreteCSSSelectorFeature(pseudo)) {
      seen.add(pseudo);
      features.push({token: pseudo});
    }
  }

  // Extract value-based features
  if (ruleText.includes('position: sticky')) {
    features.push({token: 'position-sticky'});
  }
  if (ruleText.includes('display: grid')) {
    features.push({token: 'grid'});
  }
  if (ruleText.includes('display: flex')) {
    features.push({token: 'flexbox'});
  }

  return features;
}

/**
 * Check if a CSS property is concrete (not generic)
 * @param {string} property
 * @return {boolean}
 */
function isConcreteCSSProperty(property) {
  // Exclude overly generic properties
  const genericProperties = new Set([
    'color', 'background', 'border', 'margin', 'padding',
    'width', 'height', 'display', 'position', 'top', 'left',
    'right', 'bottom', 'font-size', 'font-weight', 'text-align',
  ]);

  if (genericProperties.has(property)) {
    return false;
  }

  // Include specific feature-indicating properties
  const featureProperties = [
    'grid', 'flex', 'transform', 'animation', 'transition',
    'filter', 'backdrop-filter', 'clip-path', 'mask',
    'writing-mode', 'contain', 'aspect-ratio', 'object-fit',
    'scroll-behavior', 'overscroll-behavior', 'touch-action',
  ];

  return featureProperties.some(feature => property.startsWith(feature));
}

/**
 * Check if a CSS selector feature is concrete
 * @param {string} selector
 * @return {boolean}
 */
function isConcreteCSSSelectorFeature(selector) {
  // Include specific pseudo-classes and pseudo-elements
  const concreteSelectors = new Set([
    ':has', ':is', ':where', ':not', ':nth-child', ':nth-of-type',
    ':focus-visible', ':focus-within', '::marker', '::backdrop',
    ':target', ':checked', ':disabled', ':empty', ':first-child',
  ]);

  return concreteSelectors.has(selector);
}

/**
 * Calculate line and column from string offset
 * @param {string} content
 * @param {number} offset
 * @return {{line: number, column: number}}
 */
function calculateLineColumn(content, offset) {
  const beforeOffset = content.substring(0, offset);
  const lines = beforeOffset.split('\n');
  
  return {
    line: lines.length,
    column: lines[lines.length - 1].length,
  };
}

/**
 * Extract HTML tokens from DOM-related artifacts
 * @param {LH.Artifacts['LinkElements']=} linkElements
 * @param {LH.Artifacts['MetaElements']=} metaElements
 * @param {LH.Artifacts['ImageElements']=} imageElements
 * @param {LH.Artifacts['IFrameElements']=} iframeElements
 * @param {string=} finalUrl
 * @return {Token[]}
 */
function extractHTMLTokens(linkElements, metaElements, imageElements, iframeElements, finalUrl) {
  const tokens = [];
  const tokenMap = new Map();

  // Check link elements for concrete modern attributes
  if (linkElements) {
    for (const link of linkElements) {
      if (link.rel === 'modulepreload') {
        const key = 'html:modulepreload';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'modulepreload',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        } else {
          tokenMap.get(key).count++;
        }
      }
      if (link.rel === 'preconnect') {
        const key = 'html:preconnect';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'preconnect',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        } else {
          tokenMap.get(key).count++;
        }
      }
    }
  }

  // Check meta elements for concrete features
  if (metaElements) {
    for (const meta of metaElements) {
      if (meta.name === 'color-scheme') {
        const key = 'html:color-scheme';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'color-scheme',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        }
      }
      if (meta.name === 'theme-color') {
        const key = 'html:theme-color';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'theme-color',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        }
      }
    }
  }

  // Check image elements for concrete modern attributes
  if (imageElements) {
    for (const img of imageElements) {
      if (img.loading === 'lazy') {
        const key = 'html:loading-lazy';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'loading-lazy',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        } else {
          tokenMap.get(key).count++;
        }
      }
      if (img.attributeDecoding === 'async') {
        const key = 'html:decoding-async';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'decoding-async',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        } else {
          tokenMap.get(key).count++;
        }
      }
    }
  }

  // Check iframe elements
  if (iframeElements && iframeElements.length > 0) {
    for (const iframe of iframeElements) {
      if (iframe.loading === 'lazy') {
        const key = 'html:iframe-loading-lazy';
        if (!tokenMap.has(key)) {
          tokenMap.set(key, {
            type: 'html',
            token: 'iframe-loading-lazy',
            where: {url: finalUrl || 'document'},
            count: 1,
            originType: 'first-party',
          });
        } else {
          tokenMap.get(key).count++;
        }
      }
    }
  }

  // Convert map to array and add route info
  for (const token of tokenMap.values()) {
    if (finalUrl) {
      token.route = getRouteFromUrl(finalUrl);
    }
    tokens.push(token);
  }

  return tokens;
}

/**
 * Determine origin type for a resource
 * @param {string} resourceUrl
 * @param {string} mainUrl
 * @return {'first-party' | 'vendor'}
 */
function determineOriginType(resourceUrl, mainUrl) {
  if (!resourceUrl || !mainUrl) return 'first-party';

  try {
    const resourceOrigin = new URL(resourceUrl).origin;
    const mainOrigin = new URL(mainUrl).origin;

    // Different origin
    if (resourceOrigin !== mainOrigin) {
      return 'vendor';
    }

    // Check for vendor paths
    const vendorPaths = ['/node_modules/', '/vendor/', '/lib/', '/dist/'];
    if (vendorPaths.some(path => resourceUrl.includes(path))) {
      return 'vendor';
    }

    // Check for known CDNs
    const cdnHosts = ['cdn.', 'cdnjs.', 'unpkg.', 'jsdelivr.', 'googleapis.'];
    if (cdnHosts.some(cdn => resourceUrl.includes(cdn))) {
      return 'vendor';
    }

    return 'first-party';
  } catch {
    return 'first-party';
  }
}

/**
 * Get route from URL
 * @param {string} url
 * @return {string}
 */
function getRouteFromUrl(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

/**
 * Get line and column from string index
 * @param {string} content
 * @param {number} index
 * @return {{line: number, column: number}}
 */
function getLineColumn(content, index) {
  const before = content.substring(0, index);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Extract all tokens from Lighthouse artifacts
 * @param {LH.Artifacts} artifacts
 * @return {Token[]}
 */
function extractTokens(artifacts) {
  const allTokens = [];
  const finalUrl = artifacts.URL?.finalDisplayedUrl || artifacts.URL?.finalUrl;

  // Extract JavaScript tokens
  const jsTokens = extractJavaScriptTokens(
    artifacts.Scripts,
    artifacts.JsUsage,
    finalUrl
  );
  allTokens.push(...jsTokens);

  // Extract CSS tokens
  const cssTokens = extractCSSTokens(
    artifacts.CSSUsage,
    artifacts.Stylesheets,
    finalUrl
  );
  allTokens.push(...cssTokens);

  // Extract HTML tokens
  const htmlTokens = extractHTMLTokens(
    artifacts.LinkElements,
    artifacts.MetaElements,
    artifacts.ImageElements,
    artifacts.IFrameElements,
    finalUrl
  );
  allTokens.push(...htmlTokens);

  return allTokens;
}

export {extractTokens};
export default {extractTokens};

