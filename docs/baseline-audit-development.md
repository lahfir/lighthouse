# Baseline Audit Development Documentation

This document provides comprehensive information about the Baseline audit implementation in Lighthouse, including architecture, development workflow, debugging, and maintenance.

## Overview

The Baseline audit evaluates Web Platform features used on a webpage against [Baseline](https://web.dev/baseline) compatibility status. It detects JavaScript APIs, CSS properties, and HTML features, then reports their browser compatibility using real-time data from the WebStatus API.

### Key Metrics
- **Score**: 0-100% based on feature compatibility
- **Detection**: JavaScript tokens, CSS properties, HTML attributes
- **Status Categories**: Limited, Newly, Widely available
- **Data Sources**: web-features package + WebStatus API

## Architecture

### Component Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Token         │    │   Feature        │    │   Baseline      │
│   Extraction    │───▶│   Mapping        │───▶│   Status        │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
│                      │                        │
│ tokens.js            │ map-to-feature-ids.js  │ webstatus-client.js
│                      │                        │
▼                      ▼                        ▼
JS/CSS/HTML tokens ───▶ Feature IDs ──────────▶ Baseline Status
```

### Core Files

#### 1. Main Audit (`/core/audits/baseline-readiness.js`)
- Entry point for the audit
- Orchestrates token extraction, mapping, and scoring
- Handles error cases and warnings
- Generates report data

#### 2. Token Extraction (`/core/computed/baseline/tokens.js`)
- Extracts JavaScript APIs, CSS properties, HTML attributes
- Processes DevTools artifacts (Scripts, CSSUsage, DOM)
- Returns normalized tokens with location info

#### 3. Feature Mapping (`/core/computed/baseline/map-to-feature-ids.js`)
- Maps detected tokens to web-features IDs
- Uses precompiled mapping from web-features package
- Handles aliases and variations

#### 4. WebStatus Client (`/core/computed/baseline/webstatus-client.js`)
- Fetches live Baseline status from WebStatus API
- Implements circuit breaker pattern for reliability
- Handles batching, caching, and retry logic

#### 5. Score Calculation (`/core/computed/baseline/score.js`)
- Calculates overall compatibility score
- Weights features by importance and usage
- Provides progressive enhancement bonuses

#### 6. Feature Map Generator (`/core/scripts/baseline/update-feature-map.mjs`)
- Generates token→feature_id mappings
- Uses official web-features npm package
- Run via `yarn baseline-update-map`

### Data Flow

1. **Artifact Collection**: Lighthouse gathers Scripts, CSSUsage, DOM artifacts
2. **Token Extraction**: Extract API calls, CSS properties, HTML features
3. **Feature Mapping**: Convert tokens to standardized feature IDs
4. **Status Fetching**: Query WebStatus API for current Baseline status
5. **Score Calculation**: Weight and score features for final result
6. **Report Generation**: Format results for display

## Development Workflow

### Setup

```bash
# Install dependencies
yarn install --frozen-lockfile

# Update feature mappings (when web-features package updates)
yarn baseline-update-map

# Run tests
yarn mocha core/test/audits/baseline-readiness-test.js
```

### Testing the Audit

```bash
# Test on a simple site
node cli https://example.com --only-audits=baseline-readiness

# Test on a complex site
node cli https://web.dev --only-audits=baseline-readiness

# Save artifacts for debugging
node cli https://example.com --only-audits=baseline-readiness --save-assets

# Run with debug output
DEBUG=* node cli https://example.com --only-audits=baseline-readiness
```

### Development Commands

```bash
# Update feature mappings
yarn baseline-update-map

# Run specific tests
yarn mocha core/test/audits/baseline-readiness-test.js

# Run all Baseline-related tests
yarn mocha core/test/audits/baseline-readiness-test.js core/test/computed/baseline/

# Lint code
yarn lint

# Type check
yarn type-check
```

## Configuration

### Audit Registration

The audit is registered in `/core/config/default-config.js`:

```javascript
'baseline-readiness': require('../audits/baseline-readiness.js'),
```

And included in the Baseline category:

```javascript
baseline: {
  title: 'Baseline',
  description: 'Checks whether used Web Platform features are Baseline-safe.',
  auditRefs: [
    {id: 'baseline-readiness', weight: 1},
  ],
},
```

### WebStatus API Configuration

Key settings in `webstatus-client.js`:

```javascript
const API_BASE = "https://api.webstatus.dev/v1";
const BATCH_SIZE = 20;              // Features per API request
const REQUEST_TIMEOUT = 5000;       // 5 second timeout
const MAX_RETRIES = 3;              // Retry failed requests
const CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before opening circuit
```

## Debugging Guide

### Common Issues

#### 1. All Features Show "Unknown" Status
**Symptoms**: Audit completes but all features have "Unknown" status
**Causes**:
- WebStatus API connectivity issues
- Invalid API response format
- Circuit breaker is open

**Debugging**:
```bash
# Test API directly
curl "https://api.webstatus.dev/v1/features?q=id:fetch"

# Check circuit breaker state
node -e "
const client = await import('./core/computed/baseline/webstatus-client.js');
console.log('Stats:', client.getStats());
"
```

#### 2. No Features Detected
**Symptoms**: "No features detected" message
**Causes**:
- Simple webpage with minimal JavaScript/CSS
- Token extraction not finding patterns
- Feature mapping issues

**Debugging**:
```bash
# Test token extraction directly
node -e "
const {extractTokens} = await import('./core/computed/baseline/tokens.js');
// Test with sample artifacts
"

# Check feature mappings
cat core/computed/baseline/feature-map.json | jq 'length'
```

#### 3. Incorrect Feature Mapping
**Symptoms**: Wrong features detected for given code
**Causes**:
- Outdated feature mappings
- Missing token patterns
- Regex matching issues

**Debugging**:
```bash
# Update mappings
yarn baseline-update-map

# Check mapping for specific token
cat core/computed/baseline/feature-map.json | jq '.["fetch"]'
```

### Debug Outputs

Enable debug logging:

```bash
# Full debug output
DEBUG=* node cli https://example.com --only-audits=baseline-readiness

# Baseline-specific debug
DEBUG=lh:audit:baseline-readiness node cli https://example.com --only-audits=baseline-readiness
```

### Testing Utilities

```javascript
// Test WebStatus client directly
const {fetchBaselineStatus} = await import('./core/computed/baseline/webstatus-client.js');
const result = await fetchBaselineStatus(new Set(['fetch', 'async-await']));
console.log(result);

// Test token extraction
const {extractTokens} = await import('./core/computed/baseline/tokens.js');
const artifacts = /* your artifacts */;
const tokens = extractTokens(artifacts);
console.log(tokens);

// Test feature mapping
const {mapTokensToFeatureIds} = await import('./core/computed/baseline/map-to-feature-ids.js');
const {ids} = mapTokensToFeatureIds(tokens);
console.log(ids);
```

## Maintenance

### Regular Tasks

#### Update Feature Mappings
When web-features package is updated:

```bash
yarn baseline-update-map
```

This regenerates `core/computed/baseline/feature-map.json` with latest token patterns.

#### Monitor API Health
The WebStatus API should be monitored for:
- Response time changes
- Rate limiting adjustments
- Response format changes
- New feature additions

#### Update Tests
When adding new features or fixing bugs:

1. Add test cases to `core/test/audits/baseline-readiness-test.js`
2. Update mock data if needed
3. Verify all tests pass: `yarn mocha core/test/audits/baseline-readiness-test.js`

### Performance Considerations

#### API Request Optimization
- Batching: Up to 20 features per request
- Caching: In-memory cache for audit duration
- Circuit breaker: Prevents cascading failures
- Retries: Exponential backoff for transient errors

#### Memory Usage
- Feature mappings: ~1MB JSON file loaded once
- API cache: Grows with unique features detected
- Token extraction: Processes artifacts in streaming fashion

#### Network Usage
- Typical audit: 1-3 API requests
- Complex sites: Up to 10 requests (200+ features)
- Bandwidth: ~1KB per feature queried

## Testing Strategy

### Unit Tests (`/core/test/audits/baseline-readiness-test.js`)

**Coverage**:
- Token extraction accuracy
- Feature mapping correctness
- Score calculation logic
- API error handling
- Edge cases (no features, API failures)

**Test Categories**:
1. **Happy Path**: Normal operation with mixed feature types
2. **Edge Cases**: Empty inputs, API failures, unknown features
3. **Integration**: Full audit flow with mock artifacts
4. **Performance**: Large feature sets, API timeouts
5. **Error Handling**: Network failures, invalid responses

### Integration Tests

**Smoke Tests**: Test against real websites in CI
**API Tests**: Verify WebStatus API compatibility
**Regression Tests**: Ensure consistent scoring across versions

### Manual Testing

**Test Sites**:
- `example.com` - Minimal features
- `web.dev` - Modern Web Platform features
- `developer.mozilla.org` - Comprehensive API usage
- Legacy sites - Older browser compatibility patterns

## API Reference

### WebStatus API

**Endpoint**: `https://api.webstatus.dev/v1/features`
**Method**: GET
**Query**: `?q=id:feature1 OR id:feature2`

**Response Format**:
```json
{
  "data": [
    {
      "feature_id": "fetch",
      "baseline": {
        "status": "widely",
        "low_date": "2017-03-01",
        "high_date": "2019-09-01"
      }
    }
  ],
  "metadata": {"total": 1}
}
```

**Status Values**:
- `limited` - Not yet Baseline
- `newly` - Newly Baseline (interoperable but not yet widely available)
- `widely` - Widely available (95%+ global browser support)

### Scoring Algorithm

**Base Scores**:
- Widely: 3 points
- Newly: 2 points (1.5 if core feature)
- Limited: 0 points (-1 if core feature)
- Unknown: 0 points

**Modifiers**:
- Progressive enhancement bonus: +5% for good practices
- Core feature weighting: ±0.5 point adjustment
- Usage-based weighting: Multiply by coverage percentage

**Final Score**: `(weighted_sum / max_possible) * 100`

## Contributing

### Code Style

- Follow Lighthouse ESLint configuration
- Use JSDoc for all public functions
- Maximum 100 character line length
- No inline comments (use descriptive function names)

### Adding New Token Patterns

1. Update `core/scripts/baseline/update-feature-map.mjs`
2. Add extraction logic to `core/computed/baseline/tokens.js`
3. Run `yarn baseline-update-map`
4. Add test cases
5. Verify accuracy with real-world testing

### Performance Guidelines

- Minimize API requests through batching
- Use streaming for large artifact processing
- Implement circuit breakers for external dependencies
- Cache aggressively within audit runtime
- Profile memory usage for large codebases

## Troubleshooting

### Environment Issues

**Node.js Version**: Requires 18.20+
```bash
node --version  # Should be >= 18.20
```

**Yarn Version**: Requires 1.22.22+
```bash
yarn --version  # Should be >= 1.22.22
```

**Network Access**: Requires HTTPS access to WebStatus API
```bash
curl -I https://api.webstatus.dev/v1/features  # Should return 200
```

### Common Error Messages

**"WebStatus API unreachable"**
- Check internet connectivity
- Verify API endpoint accessibility
- Check for corporate firewall blocking

**"Invalid response structure"**
- API format may have changed
- Update response validation in `webstatus-client.js`

**"No valid feature IDs provided"**
- Feature mapping may be outdated
- Run `yarn baseline-update-map`
- Check token extraction patterns

**"Circuit breaker is open"**
- Too many API failures detected
- Wait 30 seconds for circuit breaker reset
- Check API status and connectivity

### Performance Issues

**Slow API responses**:
- Reduce `BATCH_SIZE` in webstatus-client.js
- Increase `REQUEST_TIMEOUT` for slow connections
- Monitor API response times

**High memory usage**:
- Profile token extraction for large sites
- Check for memory leaks in caching logic
- Consider streaming artifacts processing

**Audit timeouts**:
- Increase Lighthouse timeout settings
- Optimize token extraction algorithms
- Reduce API request parallelism

## Future Enhancements

### Planned Features

1. **Local Baseline Data**: Offline mode using cached web-features data
2. **Custom Baselines**: Organization-specific compatibility targets
3. **Historical Tracking**: Compare Baseline adoption over time
4. **Framework Detection**: Framework-specific compatibility analysis
5. **Polyfill Suggestions**: Recommend polyfills for Limited features

### Research Areas

- **Usage Weighting**: Better algorithms for feature importance
- **Progressive Enhancement**: More sophisticated detection
- **Performance Impact**: Correlate features with performance metrics
- **Security Implications**: Flag features with known security issues
- **Accessibility**: Consider accessibility implications of detected features

---

**Last Updated**: September 2025
**Maintainers**: Claude Code Development Team
**Issues**: Report to internal development channels