/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import {loadTargets, uaSupportFactor, normalizeUADistribution} from '../../computed/baseline/targets.js';

/* eslint-env mocha */

describe('UA-aware Weighting', () => {
  describe('normalizeUADistribution', () => {
    it('should return equal distribution for empty input', () => {
      const normalized = normalizeUADistribution({});

      assert.strictEqual(normalized.safari, 0.25);
      assert.strictEqual(normalized.chrome, 0.25);
      assert.strictEqual(normalized.firefox, 0.25);
      assert.strictEqual(normalized.edge, 0.25);
    });

    it('should normalize to sum to 1.0', () => {
      const dist = {
        safari: 30,
        chrome: 50,
        firefox: 20
      };

      const normalized = normalizeUADistribution(dist);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);

      assert(Math.abs(sum - 1.0) < 0.001);
      assert.strictEqual(normalized.edge, 0);
    });

    it('should handle negative values', () => {
      const dist = {
        safari: -10,
        chrome: 60,
        firefox: 40
      };

      const normalized = normalizeUADistribution(dist);

      assert.strictEqual(normalized.safari, 0);
      assert.strictEqual(normalized.chrome, 0.6);
      assert.strictEqual(normalized.firefox, 0.4);
    });
  });

  describe('loadTargets', () => {
    it('should return default distribution when no settings', () => {
      const targets = loadTargets({settings: {}});

      assert.strictEqual(targets.uaDistribution.safari, 0.25);
      assert.strictEqual(targets.uaDistribution.chrome, 0.25);
      assert.strictEqual(targets.uaDistribution.firefox, 0.25);
      assert.strictEqual(targets.uaDistribution.edge, 0.25);
    });

    it('should use settings.baselineTargets when provided', () => {
      const settings = {
        baselineTargets: {
          uaDistribution: {
            safari: 40,
            chrome: 35,
            firefox: 15,
            edge: 10
          }
        }
      };

      const targets = loadTargets({settings});

      assert.strictEqual(targets.uaDistribution.safari, 0.4);
      assert.strictEqual(targets.uaDistribution.chrome, 0.35);
      assert.strictEqual(targets.uaDistribution.firefox, 0.15);
      assert.strictEqual(targets.uaDistribution.edge, 0.1);
    });
  });

  describe('uaSupportFactor', () => {
    const evenDist = {safari: 0.25, chrome: 0.25, firefox: 0.25, edge: 0.25};

    it('should return 1.0 for widely supported features', () => {
      const factor = uaSupportFactor('widely', evenDist);
      assert.strictEqual(factor, 1.0);
    });

    it('should return reduced factor for limited features', () => {
      const factor = uaSupportFactor('limited', evenDist);
      assert(factor >= 0.5 && factor <= 1.0);
    });

    it('should adjust for UA distribution in limited features', () => {
      const chromeDominant = {safari: 0.1, chrome: 0.7, firefox: 0.1, edge: 0.1};
      const safariDominant = {safari: 0.7, chrome: 0.1, firefox: 0.1, edge: 0.1};

      const chromeFactor = uaSupportFactor('limited', chromeDominant);
      const safariFactor = uaSupportFactor('limited', safariDominant);

      // Chrome+Edge dominant should have higher factor for limited features
      assert(chromeFactor > safariFactor);
    });

    it('should reduce newly features with high Safari share', () => {
      const safariHeavy = {safari: 0.8, chrome: 0.1, firefox: 0.05, edge: 0.05};
      const chromeHeavy = {safari: 0.1, chrome: 0.8, firefox: 0.05, edge: 0.05};

      const safariFactor = uaSupportFactor('newly', safariHeavy);
      const chromeFactor = uaSupportFactor('newly', chromeHeavy);

      // High Safari share should reduce factor for newly features
      assert(safariFactor < chromeFactor);
    });

    it('should clamp factors to valid range', () => {
      const extremeDist = {safari: 1.0, chrome: 0, firefox: 0, edge: 0};

      const factors = ['widely', 'newly', 'limited', 'unknown'].map(
        status => uaSupportFactor(status, extremeDist)
      );

      for (const factor of factors) {
        assert(factor >= 0.5 && factor <= 1.0);
      }
    });
  });
});