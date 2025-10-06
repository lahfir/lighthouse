/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import {loadBudgets, evaluateBudgets, getRouteFromUrl} from '../../computed/baseline/budgets.js';

/* eslint-env mocha */

describe('Baseline Budgets', () => {
  describe('loadBudgets', () => {
    it('should return defaults when no settings provided', () => {
      const policy = loadBudgets({settings: {}});

      assert.strictEqual(policy.minScore, undefined);
      assert.strictEqual(policy.forbidLimited, false);
      assert.strictEqual(policy.allowUnknown, true);
      assert.deepStrictEqual(policy.perRoute, {});
    });

    it('should use settings.baselineBudgets when provided', () => {
      const settings = {
        baselineBudgets: {
          minScore: 0.85,
          forbidLimited: true,
          allowUnknown: false,
          perRoute: {
            '/api': {minScore: 0.90}
          }
        }
      };

      const policy = loadBudgets({settings});

      assert.strictEqual(policy.minScore, 0.85);
      assert.strictEqual(policy.forbidLimited, true);
      assert.strictEqual(policy.allowUnknown, false);
      assert.strictEqual(policy.perRoute['/api'].minScore, 0.90);
    });

    it('should clamp minScore to [0, 1] range', () => {
      const settings = {
        baselineBudgets: {
          minScore: 1.5,
          perRoute: {
            '/test': {minScore: -0.1}
          }
        }
      };

      const policy = loadBudgets({settings});

      assert.strictEqual(policy.minScore, 1.0);
      assert.strictEqual(policy.perRoute['/test'].minScore, 0.0);
    });
  });

  describe('evaluateBudgets', () => {
    it('should pass when no violations', () => {
      const policy = {
        minScore: 0.80,
        forbidLimited: false,
        allowUnknown: true,
        perRoute: {}
      };

      const evaluation = evaluateBudgets({
        policy,
        route: '/',
        score01: 0.85,
        rows: [
          {status: 'widely'},
          {status: 'newly'}
        ]
      });

      assert.strictEqual(evaluation.violated, false);
      assert.strictEqual(evaluation.reasons.length, 0);
    });

    it('should fail when score below minimum', () => {
      const policy = {
        minScore: 0.90,
        forbidLimited: false,
        allowUnknown: true,
        perRoute: {}
      };

      const evaluation = evaluateBudgets({
        policy,
        route: '/',
        score01: 0.85,
        rows: []
      });

      assert.strictEqual(evaluation.violated, true);
      assert.strictEqual(evaluation.reasons.length, 1);
      assert(evaluation.reasons[0].includes('score 85% < 90%'));
    });

    it('should fail when limited features forbidden', () => {
      const policy = {
        forbidLimited: true,
        allowUnknown: true,
        perRoute: {}
      };

      const evaluation = evaluateBudgets({
        policy,
        route: '/',
        score01: 0.90,
        rows: [
          {status: 'widely'},
          {status: 'limited'}
        ]
      });

      assert.strictEqual(evaluation.violated, true);
      assert.strictEqual(evaluation.reasons.length, 1);
      assert(evaluation.reasons[0].includes('1 limited feature present'));
    });

    it('should fail when unknown features not allowed', () => {
      const policy = {
        forbidLimited: false,
        allowUnknown: false,
        perRoute: {}
      };

      const evaluation = evaluateBudgets({
        policy,
        route: '/',
        score01: 0.90,
        rows: [
          {status: 'widely'},
          {status: 'unknown'}
        ]
      });

      assert.strictEqual(evaluation.violated, true);
      assert.strictEqual(evaluation.reasons.length, 1);
      assert(evaluation.reasons[0].includes('1 unknown feature present'));
    });

    it('should use per-route policies', () => {
      const policy = {
        minScore: 0.80,
        forbidLimited: false,
        allowUnknown: true,
        perRoute: {
          '/api': {
            minScore: 0.95,
            forbidLimited: true
          }
        }
      };

      const evaluation = evaluateBudgets({
        policy,
        route: '/api',
        score01: 0.90,
        rows: [{status: 'limited'}]
      });

      assert.strictEqual(evaluation.violated, true);
      assert.strictEqual(evaluation.reasons.length, 2);
      assert(evaluation.reasons[0].includes('score 90% < 95%'));
      assert(evaluation.reasons[1].includes('1 limited feature present on route /api'));
    });
  });

  describe('getRouteFromUrl', () => {
    it('should extract pathname from URL', () => {
      assert.strictEqual(getRouteFromUrl('https://example.com/api/test'), '/api/test');
      assert.strictEqual(getRouteFromUrl('https://example.com/'), '/');
      assert.strictEqual(getRouteFromUrl('https://example.com'), '/');
    });

    it('should handle invalid URLs', () => {
      assert.strictEqual(getRouteFromUrl('invalid-url'), '/');
      assert.strictEqual(getRouteFromUrl(''), '/');
    });
  });
});