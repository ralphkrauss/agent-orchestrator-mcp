import type { RunErrorCategory } from '../../contract.js';

export interface NormalizedCursorError {
  message: string;
  errorClass: string;
  code?: string;
  status?: number;
  category: RunErrorCategory;
  retryable: boolean;
}

interface ErrorShape {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  isRetryable?: boolean;
}

const knownClassCategory: Record<string, RunErrorCategory> = {
  AuthenticationError: 'auth',
  RateLimitError: 'rate_limit',
  ConfigurationError: 'invalid_model',
  NetworkError: 'backend_unavailable',
  IntegrationNotConnectedError: 'auth',
  UnknownAgentError: 'unknown',
};

export function normalizeCursorSdkError(error: unknown): NormalizedCursorError {
  const shape = readErrorShape(error);
  const message = shape.message ?? (typeof error === 'string' ? error : 'cursor SDK error');
  const errorClass = shape.name ?? 'Error';
  const status = shape.status;
  const code = shape.code;

  let category: RunErrorCategory = 'unknown';
  if (errorClass in knownClassCategory) {
    category = knownClassCategory[errorClass]!;
  } else if (typeof status === 'number') {
    if (status === 401 || status === 403) category = 'auth';
    else if (status === 429) category = 'rate_limit';
    else if (status >= 500 && status <= 599) category = 'backend_unavailable';
    else if (status === 400 || status === 404) category = 'invalid_model';
  }

  if (category === 'unknown') {
    const lower = message.toLowerCase();
    if (/(invalid api key|unauthorized|unauthorised|authentication)/.test(lower)) category = 'auth';
    else if (/(rate.?limit|too many requests)/.test(lower)) category = 'rate_limit';
    else if (/(invalid model|model .* (not found|does not exist|not supported))/.test(lower)) category = 'invalid_model';
    else if (/(network|service unavailable|connection (refused|reset|timed out)|econnrefused|etimedout)/.test(lower)) category = 'backend_unavailable';
  }

  if (errorClass === 'ConfigurationError') {
    const lower = message.toLowerCase();
    if (/(agent .* (not found|expired|stale|missing|unknown)|unknown agent|invalid agent)/.test(lower)) {
      category = 'protocol';
    }
  }

  const retryable = shape.isRetryable === true
    || category === 'rate_limit'
    || category === 'backend_unavailable';

  return { message, errorClass, code, status, category, retryable };
}

function readErrorShape(error: unknown): ErrorShape {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      name: typeof record.name === 'string' ? record.name : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      code: typeof record.code === 'string' ? record.code : undefined,
      status: typeof record.status === 'number' ? record.status : undefined,
      isRetryable: record.isRetryable === true ? true : undefined,
    };
  }
  return {};
}
