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
 *   location?: string,
 *   line?: number,
 *   column?: number
 * }} Token
 */

/**
 * Extract JavaScript tokens from Scripts artifact
 * @param {LH.Artifacts['Scripts']} scripts
 * @param {LH.Artifacts['JsUsage']=} jsUsage
 * @return {Token[]}
 */
function extractJavaScriptTokens(scripts, jsUsage) {
  const tokens = [];
  const seen = new Set();

  // Process script content if available
  if (scripts && scripts.length > 0) {
    for (const script of scripts) {
      if (!script.content) continue;

      // Extract Web API usage via simple pattern matching
      // Look for common patterns like navigator.*, window.*, new ClassName(), etc.
      const patterns = [
        /navigator\.(\w+)/g,
        /window\.(\w+)/g,
        /document\.(\w+)/g,
        /new\s+(\w+)/g,
        /(\w+)\.prototype\./g,
        /Promise\.(all|race|resolve|reject|allSettled|any)/g,
        /Array\.(from|of|isArray)/g,
        /Object\.(keys|values|entries|assign|create)/g,
        /Intl\.(\w+)/g,
        /crypto\.(\w+)/g,
        /fetch\s*\(/g,
        /async\s+function/g,
        /await\s+/g,
        /import\s*\(/g,
        /import\s+.*\s+from/g,
        /class\s+\w+/g,
        /extends\s+\w+/g,
      ];

      for (const pattern of patterns) {
        const matches = script.content.matchAll(pattern);
        for (const match of matches) {
          const token = match[1] || match[0].replace(/[^\w.]/g, '');
          if (token && !seen.has(token)) {
            seen.add(token);
            tokens.push({
              type: 'js',
              token: token.toLowerCase(),
              location: script.url || undefined,
            });
          }
        }
      }

      // Extract specific API constructors
      const apiConstructors = [
        'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
        'PerformanceObserver', 'ReportingObserver', 'Worker', 'ServiceWorker',
        'SharedWorker', 'WebSocket', 'WebAssembly', 'Proxy', 'Reflect',
        'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt',
        'URLSearchParams', 'URL', 'Blob', 'File', 'FileReader',
        'FormData', 'Headers', 'Request', 'Response', 'AbortController',
        'TextEncoder', 'TextDecoder', 'ReadableStream', 'WritableStream',
        'TransformStream', 'BroadcastChannel', 'MessageChannel',
        'customElements', 'shadowRoot', 'structuredClone',
      ];

      for (const api of apiConstructors) {
        if (script.content.includes(api) && !seen.has(api)) {
          seen.add(api);
          tokens.push({
            type: 'js',
            token: api,
            location: script.url || undefined,
          });
        }
      }
    }
  }

  // Add JsUsage data if available (for more accurate detection)
  if (jsUsage) {
    // JsUsage provides script coverage, but not specific API usage
    // We can use it to weight tokens later
  }

  return tokens;
}

/**
 * Extract CSS tokens from CSSUsage artifact
 * @param {LH.Artifacts['CSSUsage']=} cssUsage
 * @param {LH.Artifacts['Stylesheets']=} stylesheets
 * @return {Token[]}
 */
/**
 * Extract CSS properties from actual used CSS rules (smart approach)
 * @param {LH.Artifacts['CSSUsage']=} cssUsage  
 * @param {LH.Artifacts['Stylesheets']=} stylesheets
 * @return {Token[]}
 */
function extractCSSTokens(cssUsage, stylesheets) {
  const tokens = [];
  const seen = new Set();

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
    
    // Parse CSS properties from the used rule
    const properties = extractCSSPropertiesFromRule(ruleText);
    
    for (const property of properties) {
      if (!seen.has(property)) {
        seen.add(property);
        
        // Calculate line/column from offset
        const location = calculateLineColumn(stylesheet.content, rule.startOffset);
        
        tokens.push({
          type: 'css',
          token: property,
          location: sourceURL,
          line: location.line,
          column: location.column,
        });
      }
    }
  }

  return tokens;
}

/**
 * Extract CSS properties from a CSS rule text
 * @param {string} ruleText
 * @return {string[]}
 */
function extractCSSPropertiesFromRule(ruleText) {
  const properties = [];
  
  // Match CSS property declarations: property: value;
  const propertyMatches = ruleText.matchAll(/([a-z-]+)\s*:/gi);
  
  for (const match of propertyMatches) {
    const property = match[1].toLowerCase().trim();
    properties.push(property);
  }
  
  return properties;
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
 * @return {Token[]}
 */
function extractHTMLTokens(linkElements, metaElements, imageElements, iframeElements) {
  const tokens = [];
  const seen = new Set();

  // Modern HTML elements that indicate Baseline feature usage
  // const modernElements = [
  //   'dialog', 'template', 'slot', 'details', 'summary',
  //   'picture', 'video', 'audio', 'canvas', 'svg',
  //   'meter', 'progress', 'output', 'datalist', 'main',
  //   'article', 'section', 'nav', 'aside', 'header', 'footer',
  // ];

  // Check link elements for modern attributes
  if (linkElements) {
    for (const link of linkElements) {
      if (link.rel === 'modulepreload' && !seen.has('modules')) {
        seen.add('modules');
        tokens.push({type: 'html', token: 'modules'});
      }
      if (link.rel === 'preconnect' && !seen.has('preconnect')) {
        seen.add('preconnect');
        tokens.push({type: 'html', token: 'preconnect'});
      }
    }
  }

  // Check meta elements
  if (metaElements) {
    for (const meta of metaElements) {
      if (meta.name === 'color-scheme' && !seen.has('color-scheme')) {
        seen.add('color-scheme');
        tokens.push({type: 'html', token: 'color-scheme'});
      }
      if (meta.name === 'theme-color' && !seen.has('theme-color')) {
        seen.add('theme-color');
        tokens.push({type: 'html', token: 'theme-color'});
      }
    }
  }

  // Check image elements for modern attributes
  if (imageElements) {
    for (const img of imageElements) {
      if (img.loading === 'lazy' && !seen.has('loading-lazy')) {
        seen.add('loading-lazy');
        tokens.push({type: 'html', token: 'loading-lazy'});
      }
      if (img.attributeDecoding === 'async' && !seen.has('decoding')) {
        seen.add('decoding');
        tokens.push({type: 'html', token: 'decoding'});
      }
    }
  }

  // Check iframe elements
  if (iframeElements) {
    for (const iframe of iframeElements) {
      if (!seen.has('iframe')) {
        seen.add('iframe');
        tokens.push({type: 'html', token: 'iframe'});
      }
      if (iframe.loading === 'lazy' && !seen.has('iframe-lazy')) {
        seen.add('iframe-lazy');
        tokens.push({type: 'html', token: 'loading-lazy'});
      }
    }
  }

  // Add some common modern HTML features that we detect
  // In a real implementation, we'd parse MainDocumentContent
  // For now, we skip auto-adding modernElements to avoid unused variable
  // modernElements.forEach(elem => { ... });

  return tokens;
}

/**
 * Extract all tokens from Lighthouse artifacts
 * @param {LH.Artifacts} artifacts
 * @return {Token[]}
 */
function extractTokens(artifacts) {
  const allTokens = [];

  // Extract JavaScript tokens
  const jsTokens = extractJavaScriptTokens(
    artifacts.Scripts,
    artifacts.JsUsage
  );
  allTokens.push(...jsTokens);

  // Extract CSS tokens
  const cssTokens = extractCSSTokens(
    artifacts.CSSUsage,
    artifacts.Stylesheets
  );
  allTokens.push(...cssTokens);

  // Extract HTML tokens
  const htmlTokens = extractHTMLTokens(
    artifacts.LinkElements,
    artifacts.MetaElements,
    artifacts.ImageElements,
    artifacts.IFrameElements
  );
  allTokens.push(...htmlTokens);

  return allTokens;
}

export {extractTokens};
export default {extractTokens};

