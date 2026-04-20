import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';
const AUTH_URL = __ENV.AUTH_URL || `${BASE_URL}/auth/token`;
const API_PATH = __ENV.API_PATH || '/v1/orders/search';
const AUTH_ENABLED = (__ENV.AUTH_ENABLED || 'false').toLowerCase() === 'true';
const CLIENT_ID = __ENV.CLIENT_ID || 'demo-client';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || 'demo-secret';
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '30s';

const dataset = new SharedArray('load-payloads', function () {
  return Array.from({ length: 500 }, (_, i) => ({
    requestId: `load-${i + 1}`,
    query: `item-${(i % 50) + 1}`,
    page: (i % 10) + 1,
    pageSize: 20
  }));
});

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 200,
      stages: [
        { target: 20, duration: '2m' },
        { target: 50, duration: '3m' },
        { target: 80, duration: '3m' },
        { target: 80, duration: '2m' },
        { target: 0, duration: '1m' }
      ],
      exec: 'apiLoadTest'
    },
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 180 },
        { duration: '1m', target: 180 },
        { duration: '45s', target: 20 },
        { duration: '30s', target: 0 }
      ],
      startTime: '11m',
      exec: 'apiLoadTest'
    },
    soak_test: {
      executor: 'constant-vus',
      vus: 25,
      duration: '20m',
      startTime: '15m',
      exec: 'apiLoadTest'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1200', 'p(99)<2000'],
    checks: ['rate>0.98']
  }
};

function buildAuthHeader() {
  if (!AUTH_ENABLED) {
    return {};
  }

  const authRes = http.post(
    AUTH_URL,
    JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials'
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT
    }
  );

  check(authRes, {
    'auth status is 200': (r) => r.status === 200
  });

  const token = authRes.json('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiLoadTest() {
  const payload = dataset[Math.floor(Math.random() * dataset.length)];
  const authHeader = buildAuthHeader();

  const res = http.post(`${BASE_URL}${API_PATH}`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader
    },
    timeout: REQUEST_TIMEOUT
  });

  check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'response under 2s': (r) => r.timings.duration < 2000
  });

  sleep(0.2);
}
