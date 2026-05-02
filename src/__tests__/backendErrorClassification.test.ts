import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBackendError } from '../backend/common.js';

describe('backend error classification', () => {
  it('classifies common fatal backend setup and request errors', () => {
    assert.deepStrictEqual(
      classifyBackendError({
        backend: 'codex',
        source: 'stderr',
        message: 'Authentication failed: invalid API key',
      }),
      {
        message: 'Authentication failed: invalid API key',
        category: 'auth',
        source: 'stderr',
        backend: 'codex',
        retryable: false,
        fatal: true,
        context: undefined,
      },
    );

    const invalidModel = classifyBackendError({
      backend: 'codex',
      source: 'backend_event',
      message: "The 'openai/gpt-5.5' model is not supported when using Codex with a ChatGPT account.",
      context: { status: 400, type: 'invalid_request_error' },
    });
    assert.equal(invalidModel.category, 'invalid_model');
    assert.equal(invalidModel.retryable, false);
    assert.equal(invalidModel.fatal, true);

    const quota = classifyBackendError({
      backend: 'claude',
      source: 'stderr',
      message: 'Quota exceeded for this billing account',
    });
    assert.equal(quota.category, 'quota');
    assert.equal(quota.fatal, true);
  });

  it('marks rate limits retryable but still fatal for the current run', () => {
    const error = classifyBackendError({
      backend: 'claude',
      source: 'backend_event',
      message: '429 rate limit exceeded',
    });

    assert.equal(error.category, 'rate_limit');
    assert.equal(error.retryable, true);
    assert.equal(error.fatal, true);
  });

  it('keeps unknown stderr text visible without forcing fatal classification', () => {
    const error = classifyBackendError({
      backend: 'codex',
      source: 'stderr',
      message: 'background progress line',
    });

    assert.equal(error.category, 'unknown');
    assert.equal(error.retryable, false);
    assert.equal(error.fatal, false);
  });
});
