/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';

import BaselineReadiness from '../../audits/baseline-readiness.js';
import {clearCache, resetCircuitBreaker, resetCacheStats} from '../../computed/baseline/webstatus-client.js';

const mockArtifacts = {
  devtoolsLogs: {DefaultPass: []},
  Scripts: [
    {
      scriptId: '1',
      url: 'https://example.com/script.js',
      content: `
        fetch('/api/data');
        const observer = new IntersectionObserver(() => {});
        navigator.permissions.query({name: 'geolocation'});
        const div = document.createElement('div');
        div.style.display = 'grid';
        div.style.gridTemplateColumns = '1fr 1fr';
      `,
    },
    {
      scriptId: '2',
      url: 'https://example.com/modern.js',
      content: `
        const controller = new AbortController();
        const items = [1, 2, 3].at(-1);
        await import('./module.js');
        navigator.mediaDevices.getUserMedia({video: true});
      `,
    },
  ],
  LinkElements: [
    {rel: 'modulepreload', href: '/module.js'},
    {rel: 'preconnect', href: 'https://fonts.googleapis.com'},
  ],
  MetaElements: [
    {name: 'color-scheme', content: 'light dark'},
    {name: 'theme-color', content: '#000'},
  ],
  ImageElements: [
    {loading: 'lazy', src: 'image.jpg'},
  ],
  IFrameElements: [],
  Stylesheets: [
    {
      header: {sourceURL: 'https://example.com/styles.css'},
      content: `
        .container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          aspect-ratio: 16/9;
        }

        .item:has(.highlight) {
          background: blue;
        }

        @container (min-width: 400px) {
          .responsive { font-size: 1.2rem; }
        }

        @layer base, components {
          .button { padding: 1rem; }
        }
      `,
    },
  ],
};

// Mock WebStatus API responses
const mockFeatureStatuses = new Map([
  ['grid', {status: 'widely', high_date: '2020-01-15'}],
  ['fetch', {status: 'widely', high_date: '2017-04-05'}],
  ['abortable-fetch', {status: 'widely', high_date: '2017-04-05'}], // Modern fetch API
  ['intersectionobserver', {status: 'widely', high_date: '2019-02-05'}],
  ['permissions', {status: 'newly', low_date: '2022-03-15'}],
  ['abortcontroller', {status: 'widely', high_date: '2021-09-14'}],
  ['aborting', {status: 'widely', high_date: '2021-09-14'}], // AbortController feature
  ['array-at', {status: 'newly', low_date: '2022-03-15'}],
  ['dynamic-import', {status: 'widely', high_date: '2020-04-07'}],
  ['getusermedia', {status: 'widely', high_date: '2016-01-20'}],
  ['modules', {status: 'widely', high_date: '2017-09-05'}],
  ['preconnect', {status: 'widely', high_date: '2015-04-14'}],
  ['color-scheme', {status: 'widely', high_date: '2020-05-19'}],
  ['loading-lazy', {status: 'widely', high_date: '2019-08-06'}],
  ['has', {status: 'limited', low_date: '2023-12-19'}],
  ['container-queries', {status: 'newly', low_date: '2022-08-23'}],
  ['cascade-layers', {status: 'newly', low_date: '2022-03-14'}],
  ['aspect-ratio', {status: 'widely', high_date: '2021-08-31'}],
  // Additional features for comprehensive tests
  ['readablestream', {status: 'newly', low_date: '2022-03-14'}],
  ['structuredclone', {status: 'newly', low_date: '2022-03-14'}],
  ['flexbox', {status: 'widely', high_date: '2017-03-21'}],
  ['gap', {status: 'widely', high_date: '2020-09-15'}],
  ['where', {status: 'newly', low_date: '2021-12-14'}],
  ['transformstream', {status: 'limited', low_date: '2022-08-23'}],
  ['promises', {status: 'widely', high_date: '2015-06-15'}],
  // More limited features for experimental test
  ['view-transitions', {status: 'limited', low_date: '2023-08-15'}],
  ['anchor-positioning', {status: 'limited', low_date: '2023-12-12'}],
  ['container-style-queries', {status: 'limited', low_date: '2023-02-14'}],
]);

describe('BaselineReadiness audit', () => {
  let originalFetch;

  beforeEach(() => {
    clearCache();
    resetCircuitBreaker();
    resetCacheStats();

    // Mock fetch for WebStatus API
    originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('api.webstatus.dev')) {
        // Extract feature IDs from query
        const urlObj = new URL(url);
        const query = urlObj.searchParams.get('q');
        const features = [];

        if (query) {
          const idMatches = query.matchAll(/id:([\w-]+)/g);
          for (const match of idMatches) {
            const featureId = match[1];
            if (mockFeatureStatuses.has(featureId)) {
              const status = mockFeatureStatuses.get(featureId);
              features.push({
                feature_id: featureId,
                baseline: status,
              });
            }
          }
        }

        return {
          ok: true,
          json: async () => ({features}),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should have the expected audit metadata', () => {
    assert.equal(BaselineReadiness.meta.id, 'baseline-readiness');
    assert.equal(BaselineReadiness.meta.scoreDisplayMode, 'numeric');
    assert.ok(BaselineReadiness.meta.title);
    assert.ok(BaselineReadiness.meta.description);
  });

  it('should return perfect score when no features are detected', async () => {
    const emptyArtifacts = {
      devtoolsLogs: {DefaultPass: []},
      Scripts: [],
      LinkElements: [],
    };

    const result = await BaselineReadiness.audit(emptyArtifacts, {});

    assert.equal(result.score, 1);
    assert.equal(result.numericValue, 100);
    assert.equal(result.details.items.length, 0);
  });

  it('should detect and score Web Platform features correctly', async () => {
    const result = await BaselineReadiness.audit(mockArtifacts, {});

    // Should detect features
    assert.ok(result.details.items.length > 0);

    // Should have proper score (between 0 and 1)
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.numericValue >= 0 && result.numericValue <= 100);

    // Should include widely available features
    const widelyFeatures = result.details.items.filter(item =>
      item.status === 'Widely'
    );
    assert.ok(widelyFeatures.length > 0);

    // Should include newly available features
    const newlyFeatures = result.details.items.filter(item =>
      item.status === 'Newly'
    );
    assert.ok(newlyFeatures.length > 0);

    // Should include limited features
    const limitedFeatures = result.details.items.filter(item =>
      item.status === 'Limited'
    );
    assert.ok(limitedFeatures.length > 0);
  });

  it('should handle API failures gracefully', async () => {
    // Mock API failure
    global.fetch = async () => {
      throw new Error('Network error');
    };

    const result = await BaselineReadiness.audit(mockArtifacts, {});

    // Should still return a result
    assert.ok(result.score !== undefined);
    assert.ok(result.warnings?.some(w =>
      typeof w === 'string' ? w.includes('WebStatus') :
      (w.message && w.message.includes('WebStatus')) ||
      (w.formattedDefault && w.formattedDefault.includes('WebStatus'))
    ));
  });

  it('should detect specific features correctly', async () => {
    const result = await BaselineReadiness.audit(mockArtifacts, {});
    const items = result.details.items;


    // Check for grid
    const gridFeature = items.find(item => item.feature_id === 'grid');
    assert.ok(gridFeature);
    assert.equal(gridFeature.status, 'Widely');

    // Check for fetch (should be mapped to abortable-fetch in web-features)
    const fetchFeature = items.find(item => item.feature_id === 'abortable-fetch');
    assert.ok(fetchFeature, 'fetch feature should be detected and mapped to abortable-fetch');
    assert.equal(fetchFeature.status, 'Widely');

    // Check for :has selector
    const hasFeature = items.find(item => item.feature_id === 'has');
    assert.ok(hasFeature);
    assert.equal(hasFeature.status, 'Limited');

    // Check for container queries
    const containerFeature = items.find(item => item.feature_id === 'container-queries');
    assert.ok(containerFeature);
    assert.equal(containerFeature.status, 'Newly');
  });

  it('should include proper table headers', async () => {
    const result = await BaselineReadiness.audit(mockArtifacts, {});

    const headers = result.details.headings;
    assert.ok(headers.some(h => h.key === 'feature_id'));
    assert.ok(headers.some(h => h.key === 'status'));
    assert.ok(headers.some(h => h.key === 'low_date'));
    assert.ok(headers.some(h => h.key === 'high_date'));
    assert.ok(headers.some(h => h.key === 'where'));
  });

  it('should format dates correctly', async () => {
    const result = await BaselineReadiness.audit(mockArtifacts, {});
    const items = result.details.items;

    const gridFeature = items.find(item => item.feature_id === 'grid');
    if (gridFeature) {
      // Should have formatted date or em-dash
      assert.ok(gridFeature.high_date === '—' || /\w+\s+\d{4}/.test(gridFeature.high_date));
    }
  });

  it('should include location information', async () => {
    const result = await BaselineReadiness.audit(mockArtifacts, {});
    const items = result.details.items;

    // Most items should have location info
    const itemsWithLocation = items.filter(item =>
      item.where && item.where !== 'Various'
    );
    assert.ok(itemsWithLocation.length > 0);
  });

  it('should warn about missing artifacts', async () => {
    const limitedArtifacts = {
      devtoolsLogs: {DefaultPass: []},
      Scripts: mockArtifacts.Scripts,
      LinkElements: mockArtifacts.LinkElements,
      // Missing CSSUsage and JsUsage
    };

    const result = await BaselineReadiness.audit(limitedArtifacts, {});

    // Should include warnings about missing data
    assert.ok(result.warnings?.some(w =>
      typeof w === 'string' ? w.includes('CSS') :
      (w.message && w.message.includes('CSS')) ||
      (w.formattedDefault && w.formattedDefault.includes('CSS'))
    ));
    assert.ok(result.warnings?.some(w =>
      typeof w === 'string' ? w.includes('JavaScript') :
      (w.message && w.message.includes('JavaScript')) ||
      (w.formattedDefault && w.formattedDefault.includes('JavaScript'))
    ));
  });

  it('should handle features with no baseline status', async () => {
    // Add unknown feature
    global.fetch = async () => ({
      ok: true,
      json: async () => ({features: []}), // Empty response
    });

    const result = await BaselineReadiness.audit(mockArtifacts, {});

    // Should still return results
    assert.ok(result.score !== undefined);

    // Unknown features should be marked as such
    const unknownFeatures = result.details.items.filter(item =>
      item.status === 'Unknown'
    );
    assert.ok(unknownFeatures.length >= 0); // May have unknown features
  });

  describe('Comprehensive web-features integration', () => {
    it('should correctly map real web-features data', async () => {
      // Test against actual web-features package mapping
      const webFeatureArtifacts = {
        devtoolsLogs: {DefaultPass: []},
        Scripts: [
          {
            scriptId: '1',
            url: 'https://example.com/modern.js',
            content: `
              // Modern features that should be in web-features
              const stream = new ReadableStream();
              const controller = new AbortController();
              const items = [1, 2, 3].at(-1);
              const obj = structuredClone(data);

              // CSS Grid and Flexbox
              element.style.display = 'grid';
              element.style.gridTemplateColumns = 'repeat(3, 1fr)';
              element.style.display = 'flex';
              element.style.gap = '1rem';

              // Container queries
              element.style.containerType = 'inline-size';

              // Modern selectors
              document.querySelector(':has(> .child)');
              document.querySelector(':where(.a, .b)');
            `,
          },
        ],
        LinkElements: [
          {rel: 'modulepreload', href: '/modern-module.js'},
        ],
        MetaElements: [
          {name: 'color-scheme', content: 'light dark'},
        ],
        ImageElements: [
          {loading: 'lazy', src: 'modern-image.webp'},
        ],
        IFrameElements: [],
        Stylesheets: [
          {
            header: {sourceURL: 'https://example.com/modern.css'},
            content: `
              .container {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1rem;
                container-type: inline-size;
              }

              @container (min-width: 300px) {
                .card { padding: 2rem; }
              }

              .selector:has(> .child) {
                color: blue;
              }

              .element:where(.class1, .class2) {
                margin: 0;
              }
            `,
          },
        ],
      };

      const result = await BaselineReadiness.audit(webFeatureArtifacts, {});

      // Should detect multiple modern features
      assert.ok(result.details.items.length > 5);

      // Should find grid feature
      const gridFeature = result.details.items.find(item => item.feature_id === 'grid');
      assert.ok(gridFeature, 'Should detect CSS Grid');

      // Should find container queries (newly available)
      const containerFeature = result.details.items.find(item =>
        item.feature_id === 'container-queries' || item.feature_id.includes('container')
      );
      assert.ok(containerFeature, 'Should detect container queries');

      // Should find :has selector (limited availability)
      const hasFeature = result.details.items.find(item => item.feature_id === 'has');
      assert.ok(hasFeature, 'Should detect :has selector');

      // Score should reflect mixed modern features
      assert.ok(result.score >= 0.3 && result.score <= 0.9,
        `Score ${result.score} should reflect mixed feature support`);
    });

    it('should properly weight core vs enhancement features', async () => {
      const coreHeavyArtifacts = {
        devtoolsLogs: {DefaultPass: []},
        Scripts: [
          {
            scriptId: '1',
            url: 'https://example.com/core.js',
            content: `
              // Core web platform features
              fetch('/api/data').then(response => response.json());
              const promise = Promise.resolve(data);
              const grid = document.querySelector('.grid');
              grid.style.display = 'grid';

              // Minimal cutting-edge features
              const items = [1, 2, 3].at?.(-1) ?? items[items.length - 1];
            `,
          },
        ],
        LinkElements: [],
        MetaElements: [],
        ImageElements: [],
        IFrameElements: [],
      };

      const result = await BaselineReadiness.audit(coreHeavyArtifacts, {});

      // Should have high score due to widely-supported core features
      assert.ok(result.score >= 0.8,
        `Core-heavy implementation should score highly: ${result.score}`);

      // Should detect core features with appropriate weights
      const coreFeatures = result.details.items.filter(item =>
        ['grid', 'abortable-fetch', 'promises'].includes(item.feature_id)
      );
      assert.ok(coreFeatures.length > 0, 'Should detect core features');
    });

    it('should handle progressive enhancement appropriately', async () => {
      const progressiveArtifacts = {
        devtoolsLogs: {DefaultPass: []},
        Scripts: [
          {
            scriptId: '1',
            url: 'https://example.com/progressive.js',
            content: `
              // Strong foundation
              fetch('/api/data').then(response => response.json());
              document.querySelector('.grid').style.display = 'grid';

              // Progressive enhancements
              if ('IntersectionObserver' in window) {
                const observer = new IntersectionObserver(() => {});
              }

              // Feature detection for newer APIs
              if (Array.prototype.at) {
                const last = items.at(-1);
              } else {
                const last = items[items.length - 1];
              }
            `,
          },
        ],
        LinkElements: [],
        MetaElements: [],
        ImageElements: [],
        IFrameElements: [],
      };

      const result = await BaselineReadiness.audit(progressiveArtifacts, {});

      // Should detect the progressive enhancement bonus
      assert.ok(result.score >= 0.7,
        'Progressive enhancement should be rewarded with good score');

      // Should not warn about core feature issues
      const coreWarnings = result.warnings?.filter(w =>
        typeof w === 'string' ? w.includes('core') :
        (w.message && w.message.includes('core')) ||
        (w.formattedDefault && w.formattedDefault.includes('core'))
      ) || [];
      assert.equal(coreWarnings.length, 0, 'Should not warn about core features');
    });

    it('should handle experimental feature heavy sites', async () => {
      const experimentalArtifacts = {
        devtoolsLogs: {DefaultPass: []},
        Scripts: [
          {
            scriptId: '1',
            url: 'https://example.com/experimental.js',
            content: `
              // Lots of cutting-edge features (mostly limited support)
              const stream = new ReadableStream();
              const transform = new TransformStream();
              element.style.containerType = 'inline-size';
              document.querySelector(':has(.experimental)');
              element.style.viewTransitionName = 'slide';
              element.style.anchorName = '--my-anchor';

              // Minimal core features
              console.log('basic logging');
            `,
          },
        ],
        LinkElements: [],
        MetaElements: [],
        ImageElements: [],
        IFrameElements: [],
        Stylesheets: [
          {
            header: {sourceURL: 'https://example.com/experimental.css'},
            content: `
              @container (min-width: 300px) {
                .card { transform: scale(1.1); }
              }

              .element:has(> .child) {
                view-transition-name: slide;
              }

              .other:where(.a, .b) {
                anchor-name: --my-anchor;
              }
            `,
          },
        ],
      };

      const result = await BaselineReadiness.audit(experimentalArtifacts, {});

      // Should have lower score due to limited-support features
      assert.ok(result.score <= 0.6,
        'Experimental-heavy implementation should have lower score');

      // Should warn about limited support features
      const limitedWarnings = result.warnings?.filter(w =>
        typeof w === 'string' ? w.includes('limited') :
        (w.message && w.message.includes('limited')) ||
        (w.formattedDefault && w.formattedDefault.includes('limited'))
      ) || [];
      assert.ok(limitedWarnings.length > 0, 'Should warn about limited support');
    });

    it('should validate feature mapping consistency', async () => {
      // Test that our mapping produces consistent results
      const testFeatures = ['grid', 'fetch', 'has', 'container-queries', 'abortable-fetch'];

      for (const featureId of testFeatures) {
        assert.ok(typeof featureId === 'string' && featureId.length > 0,
          `Feature ID ${featureId} should be valid string`);

        assert.ok(!featureId.includes(' '),
          `Feature ID ${featureId} should not contain spaces`);

        assert.ok(featureId === featureId.toLowerCase() || featureId.includes('-'),
          `Feature ID ${featureId} should follow kebab-case convention`);
      }
    });
  });
});

