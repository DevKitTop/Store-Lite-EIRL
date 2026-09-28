import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
} from '@/lib/permissions/definitions';
import { describe, expect, test } from 'vitest';

// =====================================================
// PERMISSIONS DEFINITIONS — Unit tests
// =====================================================

describe('DEFAULT_ROLE_PERMISSIONS', () => {
  test('owner includes notifications.view', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toContain('notifications.view');
  });

  test('admin includes notifications.view', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain('notifications.view');
  });

  test('member includes notifications.view', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.member).toContain('notifications.view');
  });
});

describe('PERMISSION_GROUPS', () => {
  test('notifications group exists with correct shape', () => {
    const group = PERMISSION_GROUPS.notifications;
    expect(group).toBeDefined();
    expect(group.label).toBe('Notificaciones');
    expect(group.icon).toBe('notifications');
    expect(group.permissions).toContain('notifications.view');
  });

  test('notifications group has exactly one permission', () => {
    const group = PERMISSION_GROUPS.notifications;
    expect(group.permissions).toHaveLength(1);
  });
});

describe('PERMISSION_LABELS', () => {
  test('notifications.view has label and description', () => {
    const entry = PERMISSION_LABELS['notifications.view'];
    expect(entry).toBeDefined();
    expect(entry.label).toBe('Ver notificaciones');
    expect(entry.description).toBe('Puede ver el centro de notificaciones');
  });
});

// =====================================================
// orders.manage — required by the seller order authorization gate
// =====================================================

describe('orders.manage', () => {
  test('owner includes orders.manage', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toContain('orders.manage');
  });

  test('admin includes orders.manage', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain('orders.manage');
  });

  test('member includes orders.manage', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.member).toContain('orders.manage');
  });

  test('has a label and description', () => {
    const entry = PERMISSION_LABELS['orders.manage'];
    expect(entry).toBeDefined();
    expect(entry.label).toBe('Gestionar pedidos');
    expect(entry.description).toBe('Puede avanzar y finalizar pedidos');
  });

  test('is assignable in exactly one PERMISSION_GROUPS entry', () => {
    const groups = Object.values(PERMISSION_GROUPS).filter((group) =>
      group.permissions.includes('orders.manage'),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Pedidos');
    expect(groups[0].icon).toBe('local_shipping');
  });
});
