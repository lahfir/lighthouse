/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from './audit.js';
import * as i18n from '../lib/i18n/i18n.js';
import {extractTokens} from '../computed/baseline/tokens.js';
import {mapTokensToFeatureIds} from '../computed/baseline/map-to-feature-ids.js';
import {fetchBaselineStatus} from '../computed/baseline/webstatus-client.js';
import {calculateScore} from '../computed/baseline/score.js';
import {loadBudgets, evaluateBudgets, getRouteFromUrl} from '../computed/baseline/budgets.js';

const UIStrings = {
  /** Title of the Baseline audit when the page mostly uses widely-available features */
  title: 'Uses widely-available Web Platform features',
  /** Title of the Baseline audit when the page uses features that are not widely available */
  failureTitle: 'Uses Web Platform features with limited availability',
  /** Description of the Baseline audit */
  description: 'Baseline tracks which Web Platform features are safe to use in most browsers. ' +
    'Features marked as "Widely available" work in browsers used by 95%+ of global users. ' +
    '[Learn more about Baseline](https://web.dev/baseline).',
  /** Label for the Baseline score value */
  displayValue: `{itemCount, plural,
    =0 {No features detected}
    =1 {1 feature analyzed}
    other {# features analyzed}
  } • {score}% Baseline-ready`,
  /** Table column header for feature ID */
  columnFeature: 'Feature',
  /** Table column header for Baseline status */
  columnBaseline: 'Baseline',
  /** Table column header for when feature became newly available */
  columnNewlySince: 'Newly since',
  /** Table column header for when feature became widely available */
  columnWidelySince: 'Widely since',
  /** Table column header for where feature was found */
  columnWhereFound: 'Where found',
  /** Table column header for usage weight */
  columnWeight: 'Weight',
  /** Warning when baseline budget is violated */
  warningBudgetViolation: 'Baseline budget violation: {reasons}',
  /** Warning when CSS coverage data is not available */
  warningNoCSSCoverage: 'CSS coverage data unavailable - analysis may be incomplete',
  /** Warning when JS usage data is not available */
  warningNoJSUsage: 'JavaScript usage tracking unavailable - analysis may be incomplete',
  /** Warning when WebStatus API is unreachable */
  warningAPIUnavailable: 'WebStatus API unreachable - showing cached/unknown status',
  /** Warning when tokens couldn't be resolved to features */
  warningUnresolvedTokens: 'Some tokens did not resolve to known features (see debugData.unresolved)',
};

const str_ = i18n.createIcuMessageFn(import.meta.url, UIStrings);

/**
 * @fileoverview Audits the page's usage of Web Platform features against Baseline status
 */
class BaselineReadiness extends Audit {
  /**
   * @return {LH.Audit.Meta}
   */
  static get meta() {
    return {
      id: 'baseline-readiness',
      title: str_(UIStrings.title),
      failureTitle: str_(UIStrings.failureTitle),
      description: str_(UIStrings.description),
      scoreDisplayMode: Audit.SCORING_MODES.NUMERIC,
      requiredArtifacts: [
        'devtoolsLogs',
        'Scripts',
        'LinkElements',
        'CSSUsage',
        'Stylesheets',
      ],
    };
  }

  /**
   * Internal audit implementation with error handling
   * @param {LH.Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {Promise<LH.Audit.Product>}
   */
  static async _auditImpl(artifacts, context) {
    const warnings = [];

    try {
      // Check if navigation was successful by examining core artifacts
      // Only fail if essential artifacts are completely missing (not just empty)
      const navigationFailed = (artifacts.Scripts === undefined) ||
                               (artifacts.Stylesheets === undefined) ||
                               (artifacts.LinkElements === undefined);

      if (navigationFailed) {
        return {
          score: null,
          numericValue: 0,
          numericUnit: 'unitless',
          notApplicable: true,
          explanation: 'Baseline audit could not run because the page failed to load properly.',
          details: Audit.makeTableDetails(
            [
              {key: 'feature_id', label: str_(UIStrings.columnFeature), valueType: 'text'},
              {key: 'status', label: str_(UIStrings.columnBaseline), valueType: 'text'},
            ],
            []
          ),
        };
      }
    } catch (error) {
      // Handle any unexpected errors during artifact inspection
      return {
        score: null,
        numericValue: 0,
        numericUnit: 'unitless',
        errorMessage: 'Baseline audit encountered an error during initialization.',
        details: Audit.makeTableDetails(
          [
            {key: 'feature_id', label: str_(UIStrings.columnFeature), valueType: 'text'},
            {key: 'status', label: str_(UIStrings.columnBaseline), valueType: 'text'},
          ],
          []
        ),
      };
    }

    // Step 1: Extract tokens from artifacts
    let tokens;
    try {
      tokens = extractTokens(artifacts);
    } catch (err) {
      return {
        score: null,
        numericValue: 0,
        numericUnit: 'unitless',
        errorMessage: `Token extraction failed: ${err.message}`,
        details: Audit.makeTableDetails(
          [
            {key: 'feature_id', label: str_(UIStrings.columnFeature), valueType: 'text'},
            {key: 'status', label: str_(UIStrings.columnBaseline), valueType: 'text'},
          ],
          []
        ),
      };
    }

    if (tokens.length === 0) {
      return {
        score: 1,
        numericValue: 100,
        numericUnit: 'unitless',
        displayValue: str_(UIStrings.displayValue, {itemCount: 0, score: 100}),
        details: Audit.makeTableDetails(
          [
            {key: 'feature_id', label: str_(UIStrings.columnFeature), type: 'text'},
            {key: 'status', label: str_(UIStrings.columnBaseline), type: 'text'},
          ],
          []
        ),
      };
    }

    // Check what artifacts are available
    if (!artifacts.CSSUsage) {
      warnings.push(str_(UIStrings.warningNoCSSCoverage));
    }
    if (!artifacts.JsUsage) {
      warnings.push(str_(UIStrings.warningNoJSUsage));
    }

    // Step 2: Map tokens to feature IDs
    const mappingResult = mapTokensToFeatureIds(tokens);
    const featureIds = mappingResult.ids;
    const unresolvedTokens = mappingResult.unresolved;

    if (featureIds.size === 0) {
      return {
        score: 1,
        numericValue: 100,
        numericUnit: 'unitless',
        displayValue: str_(UIStrings.displayValue, {itemCount: 0, score: 100}),
        warnings,
        details: Audit.makeTableDetails(
          [
            {key: 'feature_id', label: str_(UIStrings.columnFeature), type: 'text'},
            {key: 'status', label: str_(UIStrings.columnBaseline), type: 'text'},
          ],
          []
        ),
      };
    }

    // Step 3: Fetch Baseline statuses
    let featureStatuses;
    try {
      featureStatuses = await fetchBaselineStatus(featureIds);
    } catch (err) {
      // API unavailable, use unknown status for all
      featureStatuses = new Map();
      for (const id of featureIds) {
        featureStatuses.set(id, {status: 'unknown'});
      }
      warnings.push(str_(UIStrings.warningAPIUnavailable));
    }

    // Build token to feature mapping for location lookup
    const tokenToFeatureMap = new Map();
    for (const token of tokens) {
      const mapped = mapTokensToFeatureIds([token]);
      if (mapped.ids.size > 0) {
        tokenToFeatureMap.set(token.token, Array.from(mapped.ids)[0]);
      }
    }

    // Step 4: Calculate score
    const usageData = artifacts.JsUsage || artifacts.CSSUsage ? {} : null;
    const scoreResult = calculateScore(
      featureStatuses,
      tokens,
      tokenToFeatureMap,
      usageData,
      context.settings
    );

    // Add warnings from scoring
    warnings.push(...scoreResult.warnings);

    // Add warning if unresolved tokens exist
    if (unresolvedTokens.length > 0) {
      warnings.push(str_(UIStrings.warningUnresolvedTokens));
    }

    // Load and evaluate budgets
    const policy = loadBudgets({
      settings: context.settings,
      mainDocumentUrl: artifacts.URL?.finalDisplayedUrl,
    });
    const route = getRouteFromUrl(artifacts.URL?.finalDisplayedUrl || '/');
    const budgetEvaluation = evaluateBudgets({
      policy,
      route,
      score01: scoreResult.score01,
      rows: scoreResult.rows,
    });

    // Override score if budget violated
    let finalScore = scoreResult.score01;
    if (budgetEvaluation.violated) {
      finalScore = 0;
      warnings.push(str_(UIStrings.warningBudgetViolation, {
        reasons: budgetEvaluation.reasons.join('; '),
      }));
    }

    // Generate summary stats for display value
    // const stats = generateSummaryStats(scoreResult.rows);

    // Build table headings following Lighthouse patterns
    const headings = [
      {key: 'feature_id', label: str_(UIStrings.columnFeature), valueType: 'text'},
      {key: 'status', label: str_(UIStrings.columnBaseline), valueType: 'text'},
      {key: 'low_date', label: str_(UIStrings.columnNewlySince), valueType: 'text'},
      {key: 'high_date', label: str_(UIStrings.columnWidelySince), valueType: 'text'},
      {key: 'url', label: str_(UIStrings.columnWhereFound), valueType: 'url',
        subItemsHeading: {key: 'location', valueType: 'source-location'}},
    ];

    // Add weight column if we have usage data
    if (usageData && scoreResult.rows.some(r => r.weight !== undefined)) {
      headings.push({key: 'weight', label: str_(UIStrings.columnWeight), valueType: 'numeric'});
    }

    // Format rows for display with expandable source locations
    const tableRows = scoreResult.rows.map(row => {
      const locationData = row.where;
      const formattedRow = {
        feature_id: row.feature_id,
        status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
        low_date: row.low_date || '—',
        high_date: row.high_date || '—',
        url: locationData.url,
        weight: row.weight !== undefined ? row.weight.toFixed(1) : undefined,
      };

      // Add expandable sub-items if available
      if (locationData.subItems) {
        formattedRow.subItems = locationData.subItems;
      }

      return formattedRow;
    });

    return {
      score: finalScore,
      numericValue: scoreResult.numeric100,
      numericUnit: 'unitless',
      displayValue: str_(UIStrings.displayValue, {
        itemCount: featureIds.size,
        score: scoreResult.numeric100,
      }),
      warnings: warnings.length > 0 ? warnings : undefined,
      details: Audit.makeTableDetails(headings, tableRows, {
        isEntityGrouped: false,
      }),
      debugData: {
        policy: policy,
        route: route,
        budgetViolated: budgetEvaluation.violated,
        mapVersion: mappingResult.mapVersion,
        unresolved: unresolvedTokens.length > 0 ?
          unresolvedTokens.slice(0, 10).map(t => t.token) : undefined,
      },
      metricSavings: {
        // Could add performance metrics here if we correlate with loading impact
      },
    };
  }

  /**
   * @param {LH.Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {Promise<LH.Audit.Product>}
   */
  static async audit(artifacts, context) {
    try {
      return await this._auditImpl(artifacts, context);
    } catch (error) {
      // Comprehensive error handling for any unexpected issues
      return {
        score: null,
        numericValue: 0,
        numericUnit: 'unitless',
        errorMessage: `Baseline audit failed: ${error.message || 'Unknown error'}`,
        details: Audit.makeTableDetails(
          [
            {key: 'feature_id', label: str_(UIStrings.columnFeature), valueType: 'text'},
            {key: 'status', label: str_(UIStrings.columnBaseline), valueType: 'text'},
          ],
          []
        ),
      };
    }
  }
}

export default BaselineReadiness;

