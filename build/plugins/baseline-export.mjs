#!/usr/bin/env node
/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Export Baseline audit results in various formats
 * Usage: node build/plugins/baseline-export.mjs report.json --format=csv --out=baseline.csv
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse command line arguments
 * @param {Array} args
 * @return {Object}
 */
function parseArgs(args) {
  const options = {
    input: null,
    format: 'json',
    out: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--format=')) {
      options.format = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      options.input = arg;
    }
  }

  if (!options.out) {
    const ext = options.format === 'sarif' ? 'sarif' : options.format;
    options.out = `baseline.${ext}`;
  }

  return options;
}

/**
 * Load and extract baseline data from LHR
 * @param {string} filepath
 * @return {Object}
 */
function loadBaselineData(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const lhr = JSON.parse(content);
    const audit = lhr?.audits?.['baseline-readiness'];

    if (!audit || !audit.details) {
      throw new Error('Baseline audit not found in report');
    }

    return {
      score: audit.score,
      numericValue: audit.numericValue,
      items: audit.details.items || [],
      debugData: audit.debugData || {},
      finalUrl: lhr.finalUrl || lhr.requestedUrl,
    };
  } catch (err) {
    console.error(`Failed to load baseline data: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Export as JSON
 * @param {Object} data
 * @return {string}
 */
function exportJSON(data) {
  const output = {
    url: data.finalUrl,
    score: data.score,
    numericValue: data.numericValue,
    policy: data.debugData.policy || {},
    features: data.items.map(item => ({
      feature_id: item.feature_id,
      status: item.status,
      newly_since: item.low_date || null,
      widely_since: item.high_date || null,
      where: item.url || null,
      weight: item.weight || 1.0,
      origin: item.originType || 'first-party',
      route: item.route || '/',
    })),
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Export as CSV
 * @param {Object} data
 * @return {string}
 */
function exportCSV(data) {
  const headers = ['feature_id', 'status', 'newly', 'widely', 'where', 'weight', 'origin', 'route'];
  const rows = [headers.join(',')];

  for (const item of data.items) {
    const row = [
      item.feature_id,
      item.status,
      item.low_date || '',
      item.high_date || '',
      item.url || '',
      item.weight || '1.0',
      item.originType || 'first-party',
      item.route || '/',
    ];

    // Escape CSV values
    const escaped = row.map(val => {
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });

    rows.push(escaped.join(','));
  }

  return rows.join('\n');
}

/**
 * Export as SARIF
 * @param {Object} data
 * @return {string}
 */
function exportSARIF(data) {
  const sarif = {
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Lighthouse Baseline',
          version: '1.0.0',
          rules: [],
        },
      },
      results: [],
    }],
  };

  const run = sarif.runs[0];
  const levelMap = {
    'limited': 'error',
    'newly': 'warning',
    'widely': 'note',
    'unknown': 'none',
  };

  // Build rules and results
  for (const item of data.items) {
    const ruleId = `baseline/${item.feature_id}`;

    // Add rule
    run.tool.driver.rules.push({
      id: ruleId,
      name: item.feature_id,
      shortDescription: {
        text: `Baseline status: ${item.status}`,
      },
    });

    // Add result
    const result = {
      ruleId: ruleId,
      level: levelMap[item.status.toLowerCase()] || 'none',
      message: {
        text: `Feature ${item.feature_id} has baseline status: ${item.status}`,
      },
    };

    // Add location if available
    if (item.url) {
      result.locations = [{
        physicalLocation: {
          artifactLocation: {
            uri: item.url,
          },
        },
      }];

      if (item.line) {
        result.locations[0].physicalLocation.region = {
          startLine: item.line,
          startColumn: item.column || 1,
        };
      }
    }

    run.results.push(result);
  }

  return JSON.stringify(sarif, null, 2);
}

/**
 * Main export function
 */
function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (!options.input) {
    console.error('Usage: baseline-export.mjs report.json [--format=json|csv|sarif] [--out=file]');
    process.exit(1);
  }

  console.log(`Loading report: ${options.input}`);
  const data = loadBaselineData(options.input);

  let output;
  switch (options.format) {
    case 'csv':
      output = exportCSV(data);
      break;
    case 'sarif':
      output = exportSARIF(data);
      break;
    case 'json':
    default:
      output = exportJSON(data);
      break;
  }

  fs.writeFileSync(options.out, output);
  console.log(`Exported ${data.items.length} features to ${options.out}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}