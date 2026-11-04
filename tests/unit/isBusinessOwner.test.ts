import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/core/database/client', () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
}));

import { isBusinessOwner } from '@/lib/permissions/checkPermission';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('isBusinessOwner', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('returns true when the definer function reports ownership', async () => {
    execute.mockResolvedValue([{ is_owner: true }]);

    await expect(isBusinessOwner(BUSINESS_ID, USER_ID)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns false when the user is not the owner', async () => {
    execute.mockResolvedValue([{ is_owner: false }]);

    await expect(isBusinessOwner(BUSINESS_ID, USER_ID)).resolves.toBe(false);
  });

  it('returns false without querying when there is no user', async () => {
    await expect(isBusinessOwner(BUSINESS_ID, undefined)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns false when the function returns no row', async () => {
    execute.mockResolvedValue([]);

    await expect(isBusinessOwner(BUSINESS_ID, USER_ID)).resolves.toBe(false);
  });
});
