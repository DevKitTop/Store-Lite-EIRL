import { GET } from '@/app/api/cron/push-fanout/route';
import { runPushFanoutBatch } from '@/lib/push/pushFanoutWorker';

vi.mock('@/lib/push/pushFanoutWorker', () => ({
  runPushFanoutBatch: vi.fn(),
}));

const mockedRunBatch = vi.mocked(runPushFanoutBatch);

function cronRequest(token?: string, headerName?: 'authorization' | 'x-cron-secret') {
  const headers = new Headers();
  if (token && headerName === 'authorization') headers.set('authorization', `Bearer ${token}`);
  if (token && headerName === 'x-cron-secret') headers.set('x-cron-secret', token);
  return new Request('http://localhost/api/cron/push-fanout', { method: 'GET', headers });
}

describe('GET /api/cron/push-fanout (T2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mockedRunBatch.mockResolvedValue({
      claimed: 0,
      delivered: 0,
      retryable: 0,
      terminal: 0,
      invalidated: 0,
      skipped: 0,
    });
  });

  test('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(cronRequest('test-cron-secret', 'x-cron-secret'));

    expect(res.status).toBe(401);
    expect(mockedRunBatch).not.toHaveBeenCalled();
  });

  test('rejects missing and wrong secrets without running the worker', async () => {
    expect((await GET(cronRequest())).status).toBe(401);
    expect((await GET(cronRequest('wrong', 'x-cron-secret'))).status).toBe(401);
    expect(mockedRunBatch).not.toHaveBeenCalled();
  });

  test('accepts the timing-safe bearer secret and returns the batch summary', async () => {
    const res = await GET(cronRequest('test-cron-secret', 'authorization'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockedRunBatch).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ success: true, claimed: 0 });
  });

  test('accepts the x-cron-secret header', async () => {
    const res = await GET(cronRequest('test-cron-secret', 'x-cron-secret'));

    expect(res.status).toBe(200);
    expect(mockedRunBatch).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when the worker throws', async () => {
    mockedRunBatch.mockRejectedValueOnce(new Error('worker unavailable'));

    const res = await GET(cronRequest('test-cron-secret', 'x-cron-secret'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ success: false });
  });
});
