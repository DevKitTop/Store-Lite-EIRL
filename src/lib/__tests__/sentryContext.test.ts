import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applySentryContext, buildSentryScope, setSentryContext } from '../sentryContext';

// â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const mockSetUser = vi.fn();
const mockSetTag = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  setUser: (...args: unknown[]) => mockSetUser(...args),
  setTag: (...args: unknown[]) => mockSetTag(...args),
}));

describe('setSentryContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('sets user id when authenticated', () => {
    setSentryContext({ id: 'user-123' });

    expect(mockSetUser).toHaveBeenCalledWith({ id: 'user-123' });
  });

  it('does not set user when called without user', () => {
    setSentryContext(undefined);

    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it('sets business_id and plan tags when business is provided', () => {
    setSentryContext({ id: 'user-1' }, { id: 'biz-42', plan: 'pro' });

    expect(mockSetTag).toHaveBeenCalledWith('business_id', 'biz-42');
    expect(mockSetTag).toHaveBeenCalledWith('plan', 'pro');
  });

  it('sets business_id with "none" when plan is not provided', () => {
    setSentryContext({ id: 'user-1' }, { id: 'biz-99' });

    expect(mockSetTag).toHaveBeenCalledWith('business_id', 'biz-99');
    expect(mockSetTag).toHaveBeenCalledWith('plan', 'none');
  });

  it('does not set business tags when business is not provided', () => {
    setSentryContext({ id: 'user-1' });

    expect(mockSetTag).not.toHaveBeenCalled();
  });

  it('never throws when Sentry is unavailable', () => {
    mockSetTag.mockImplementation(() => {
      throw new Error('sentry down');
    });

    expect(() => setSentryContext({ id: 'user-1' }, { id: 'biz-1', plan: 'pro' })).not.toThrow();
  });
});

describe('buildSentryScope', () => {
  it('maps the analytics context onto a Sentry user and tags', () => {
    const scope = buildSentryScope(
      { userId: 'user-1', businessId: 'biz-1', plan: 'emprendedor' },
      '/mi-tienda/dashboard',
    );

    expect(scope.user).toEqual({ id: 'user-1' });
    expect(scope.tags).toEqual({
      business_id: 'biz-1',
      plan: 'emprendedor',
      route: '/mi-tienda/dashboard',
    });
  });

  it('omits the user when the visitor is anonymous', () => {
    const scope = buildSentryScope({ userId: null, businessId: null, plan: 'none' });

    expect(scope.user).toBeNull();
    expect(scope.tags).toEqual({ plan: 'none' });
  });

  it('omits the business tag when the user has no membership', () => {
    const scope = buildSentryScope({ userId: 'user-1', businessId: null, plan: 'none' });

    expect(scope.tags).not.toHaveProperty('business_id');
  });

  it('never carries credentials, tokens or contact data', () => {
    const scope = buildSentryScope(
      { userId: 'user-1', businessId: 'biz-1', plan: 'pro' },
      '/checkout',
    );

    const keys = Object.keys(scope.tags);
    expect(keys.sort()).toEqual(['business_id', 'plan', 'route']);
    expect(scope.user && Object.keys(scope.user)).toEqual(['id']);
  });
});

describe('applySentryContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('sets the user and every tag on the current Sentry scope', () => {
    applySentryContext({ userId: 'user-1', businessId: 'biz-1', plan: 'pro' }, '/dashboard');

    expect(mockSetUser).toHaveBeenCalledWith({ id: 'user-1' });
    expect(mockSetTag).toHaveBeenCalledWith('business_id', 'biz-1');
    expect(mockSetTag).toHaveBeenCalledWith('plan', 'pro');
    expect(mockSetTag).toHaveBeenCalledWith('route', '/dashboard');
  });

  it('does not touch the user scope for anonymous visitors', () => {
    applySentryContext({ userId: null, businessId: null, plan: 'none' });

    expect(mockSetUser).not.toHaveBeenCalled();
    expect(mockSetTag).toHaveBeenCalledWith('plan', 'none');
  });

  it('never throws when Sentry is unavailable', () => {
    mockSetTag.mockImplementation(() => {
      throw new Error('sentry down');
    });

    expect(() =>
      applySentryContext({ userId: null, businessId: null, plan: 'none' }),
    ).not.toThrow();
  });
});
