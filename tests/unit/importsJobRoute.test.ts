// =====================================================
// GET /api/imports/[jobId] — Route tests
//
// The read that used to run on the owning client now runs through the tenant
// runner, so RLS decides what exists. That changes one observable contract:
// a job belonging to another business is invisible, and the caller gets the
// same 404 as a job that was never created. The 403 stays for a visible job
// the caller does not own.
// =====================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BUSINESS_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = 'user-1';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isBusinessOwner: vi.fn(),
  withTenantContext: vi.fn(),
  processRows: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock('@/core/database/tenant', () => ({
  withTenantContext: mocks.withTenantContext,
}));

vi.mock('@/lib/permissions/checkPermission', () => ({
  isBusinessOwner: mocks.isBusinessOwner,
}));

vi.mock('@/lib/errorHandling', () => ({
  logError: mocks.logError,
}));

vi.mock('../../app/api/imports/lib', () => ({
  CHUNK_SIZE: 2,
  processRows: mocks.processRows,
}));

import { GET } from '@/app/api/imports/[jobId]/route';

/** A thenable that also exposes `.returning()`, which is how Drizzle chains end. */
function chain(
  rows: unknown[] = [{ processedRows: 1, errorRows: 1, totalRows: 2, status: 'processing' }],
) {
  const promise = Promise.resolve(rows);
  return { returning: () => promise, then: promise.then.bind(promise) };
}

interface TenantStubOptions {
  job?: Record<string, unknown> | null;
  rows?: unknown[];
}

function tenantStub({ job = null, rows = [] }: TenantStubOptions = {}) {
  const setCalls: unknown[] = [];
  return {
    setCalls,
    tenant: {
      query: {
        importJobs: { findFirst: vi.fn().mockResolvedValue(job) },
        importRows: { findMany: vi.fn().mockResolvedValue(rows) },
      },
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          setCalls.push(values);
          return { where: vi.fn(() => chain()) };
        }),
      })),
    },
  };
}

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: JOB_ID,
    businessId: BUSINESS_ID,
    status: 'processing',
    totalRows: 2,
    processedRows: 0,
    errorRows: 0,
    completedAt: null,
    ...overrides,
  };
}

function callRoute() {
  return GET(new Request(`http://localhost/api/imports/${JOB_ID}`), {
    params: Promise.resolve({ jobId: JOB_ID }),
  });
}

describe('GET /api/imports/[jobId]', () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.isBusinessOwner.mockResolvedValue(true);
    mocks.logError.mockReset();
    mocks.processRows.mockReset();
    mocks.withTenantContext.mockReset();
  });

  it('returns 401 without touching the tenant runner when there is no session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(mocks.withTenantContext).not.toHaveBeenCalled();
  });

  it('returns 404 when the job is not visible to the caller', async () => {
    const { tenant } = tenantStub({ job: null });
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(tenant));

    const response = await callRoute();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Trabajo no encontrado' });
    // RLS already decided; ownership is not even consulted.
    expect(mocks.isBusinessOwner).not.toHaveBeenCalled();
    expect(mocks.withTenantContext).toHaveBeenCalledWith({ sub: USER_ID }, expect.any(Function));
  });

  it('returns 403 when the job is visible but the caller is not the owner', async () => {
    const { tenant } = tenantStub({ job: jobRow({ businessId: OTHER_BUSINESS_ID }) });
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(tenant));
    mocks.isBusinessOwner.mockResolvedValue(false);

    const response = await callRoute();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'No tienes acceso a este trabajo' });
    expect(mocks.isBusinessOwner).toHaveBeenCalledWith(OTHER_BUSINESS_ID, USER_ID);
    // No chunk was claimed after the refusal.
    expect(tenant.query.importRows.findMany).not.toHaveBeenCalled();
  });

  it('returns a terminal job without claiming another chunk', async () => {
    const { tenant, setCalls } = tenantStub({
      job: jobRow({ status: 'failed', processedRows: 1, errorRows: 1 }),
    });
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(tenant));

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ jobId: JOB_ID, status: 'failed', processedRows: 1, errorRows: 1 }),
    );
    expect(setCalls).toHaveLength(0);
    expect(mocks.processRows).not.toHaveBeenCalled();
  });

  it('marks the job completed when there are no pending rows left', async () => {
    const { tenant, setCalls } = tenantStub({ job: jobRow(), rows: [] });
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(tenant));

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(setCalls).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(mocks.processRows).not.toHaveBeenCalled();
  });

  it('moves a pending job to processing before reading the chunk', async () => {
    const { tenant, setCalls } = tenantStub({ job: jobRow({ status: 'pending' }), rows: [] });
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(tenant));

    await callRoute();

    expect(setCalls[0]).toEqual(expect.objectContaining({ status: 'processing' }));
  });

  it('processes the chunk and reports the counters the database returned', async () => {
    const rows = [
      { id: 'r1', rowNumber: 1, status: 'pending' },
      { id: 'r2', rowNumber: 2, status: 'pending' },
    ];
    const { tenant } = tenantStub({ job: jobRow(), rows });
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(tenant));
    mocks.processRows.mockResolvedValue([{ rowNumber: 1 }, { rowNumber: 2, error: 'bad price' }]);

    const response = await callRoute();

    expect(mocks.processRows).toHaveBeenCalledWith(rows, BUSINESS_ID, expect.anything());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        jobId: JOB_ID,
        status: 'processing',
        chunkProcessed: 2,
        firstError: 'bad price',
      }),
    );
  });
});
