/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import child_process from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* eslint-env mocha */

describe('Baseline Diff Tool', () => {
  const diffScriptPath = path.resolve(__dirname, '../../../build/plugins/baseline-diff.mjs');

  /**
   * Create a mock LHR with baseline audit
   * @param {number} score
   * @param {Array} items
   * @return {Object}
   */
  function createMockLHR(score, items) {
    return {
      audits: {
        'baseline-readiness': {
          score,
          numericValue: score * 100,
          details: {
            items: items.map(item => ({
              feature_id: item.feature_id,
              status: item.status,
              weight: item.weight || 1.0,
              ...item
            }))
          }
        }
      }
    };
  }

  it('should calculate score delta correctly', async () => {
    const baseLHR = createMockLHR(0.90, [
      {feature_id: 'grid', status: 'Widely', weight: 1.0},
      {feature_id: 'flexbox', status: 'Widely', weight: 1.0}
    ]);

    const headLHR = createMockLHR(0.85, [
      {feature_id: 'grid', status: 'Widely', weight: 1.0},
      {feature_id: 'flexbox', status: 'Newly', weight: 1.0}
    ]);

    // Create temp files
    const tempDir = path.join(__dirname, 'temp');
    fs.mkdirSync(tempDir, {recursive: true});

    const basePath = path.join(tempDir, 'base.json');
    const headPath = path.join(tempDir, 'head.json');

    fs.writeFileSync(basePath, JSON.stringify(baseLHR));
    fs.writeFileSync(headPath, JSON.stringify(headLHR));

    try {
      // Run diff tool
      const result = child_process.spawnSync('node', [diffScriptPath, basePath, headPath], {
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 0, `Diff tool failed: ${result.stderr}`);

      // Check output file
      const diffPath = path.join(tempDir, 'head-baseline-diff.json');
      assert(fs.existsSync(diffPath), 'Diff output file should exist');

      const diff = JSON.parse(fs.readFileSync(diffPath, 'utf8'));

      // Score should decrease
      assert(diff.scoreDelta < 0, 'Score delta should be negative');
      assert.strictEqual(diff.newLimited.length, 0);
      assert.strictEqual(diff.downgrades.length, 1);
      assert.strictEqual(diff.downgrades[0].feature_id, 'flexbox');
      assert.strictEqual(diff.downgrades[0].from, 'widely');
      assert.strictEqual(diff.downgrades[0].to, 'newly');

    } finally {
      // Clean up
      fs.rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it('should detect new limited features', async () => {
    const baseLHR = createMockLHR(1.0, [
      {feature_id: 'grid', status: 'Widely'}
    ]);

    const headLHR = createMockLHR(0.5, [
      {feature_id: 'grid', status: 'Widely'},
      {feature_id: 'popover', status: 'Limited'}
    ]);

    // Create temp files
    const tempDir = path.join(__dirname, 'temp2');
    fs.mkdirSync(tempDir, {recursive: true});

    const basePath = path.join(tempDir, 'base.json');
    const headPath = path.join(tempDir, 'head.json');

    fs.writeFileSync(basePath, JSON.stringify(baseLHR));
    fs.writeFileSync(headPath, JSON.stringify(headLHR));

    try {
      // Run diff tool
      const result = child_process.spawnSync('node', [diffScriptPath, basePath, headPath], {
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 0, `Diff tool failed: ${result.stderr}`);

      const diffPath = path.join(tempDir, 'head-baseline-diff.json');
      const diff = JSON.parse(fs.readFileSync(diffPath, 'utf8'));

      assert.strictEqual(diff.newLimited.length, 1);
      assert.strictEqual(diff.newLimited[0].feature_id, 'popover');

    } finally {
      // Clean up
      fs.rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it('should handle missing baseline audit gracefully', async () => {
    const emptyLHR = {audits: {}};

    const tempDir = path.join(__dirname, 'temp3');
    fs.mkdirSync(tempDir, {recursive: true});

    const basePath = path.join(tempDir, 'base.json');
    const headPath = path.join(tempDir, 'head.json');

    fs.writeFileSync(basePath, JSON.stringify(emptyLHR));
    fs.writeFileSync(headPath, JSON.stringify(emptyLHR));

    try {
      const result = child_process.spawnSync('node', [diffScriptPath, basePath, headPath], {
        encoding: 'utf8'
      });

      // Should exit with error code 1
      assert.strictEqual(result.status, 1);
      assert(result.stderr.includes('Baseline audit not found'));

    } finally {
      // Clean up
      fs.rmSync(tempDir, {recursive: true, force: true});
    }
  });
});