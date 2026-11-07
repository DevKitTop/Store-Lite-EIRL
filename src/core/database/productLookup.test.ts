import { isUuid, productIdentifierWhere } from '@/core/database/productLookup';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

const dialect = new PgDialect();

const UUID = 'c5171128-25c7-453d-850c-4d936284de79';

function toQuery(value: string) {
  const where = productIdentifierWhere(value);
  if (!where) throw new Error('productIdentifierWhere returned no condition');
  return dialect.sqlToQuery(where);
}

describe('productIdentifierWhere', () => {
  test('detects uuids', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid('polo-algodon')).toBe(false);
    expect(isUuid('')).toBe(false);
    // A slug that merely starts with hex characters is not a uuid.
    expect(isUuid('deadbeef-cafe-4bad-8abc-1234567890ab-extra')).toBe(false);
  });

  test('matches only the slug when the value is not a uuid', () => {
    // Postgres raises 22P02 when a uuid column is compared against a slug,
    // which is what broke the product page for every slug URL.
    const query = toQuery('polo-algodon');

    expect(query.sql).toContain('"slug"');
    expect(query.sql).not.toContain('"id"');
    expect(query.params).toEqual(['polo-algodon']);
  });

  test('matches the id and the slug when the value is a uuid', () => {
    const query = toQuery(UUID);

    expect(query.sql).toContain('"id"');
    expect(query.sql).toContain('"slug"');
    expect(query.sql).toContain(' or ');
    expect(query.params).toEqual([UUID, UUID]);
  });
});
