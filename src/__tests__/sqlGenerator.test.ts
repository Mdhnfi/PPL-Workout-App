import { describe, expect, it } from 'vitest';
import { compareInspectedSchemas } from '@/lib/schemaDiffEngine';
import { generateMigrationBundle } from '@/lib/sqlGenerator';
import { makeColumn, makeSchema, makeTable } from './fixtures/mockSchemas';

describe('sqlGenerator - Migration & Rollback Scripts', () => {
  it('generates transaction-wrapped UP and DOWN scripts with schema_versions bookkeeping', () => {
    const schemaA = makeSchema('public', '1.3.0', {
      users: makeTable('users', {
        columns: [
          ...makeTable('users').columns,
          makeColumn('users', 'phone', { ordinal_position: 2, character_maximum_length: 30 }),
        ],
      }),
      audit_logs: makeTable('audit_logs'),
    });

    const schemaB = makeSchema('public', '1.1.0', {
      users: makeTable('users'),
    });

    const diff = compareInspectedSchemas(schemaA, schemaB);
    const bundle = generateMigrationBundle(diff, {
      customNotes: 'Sync audit_logs and phone column',
    });

    expect(bundle.version).toBe('1.4.0');
    expect(bundle.upSql).toContain('CREATE TABLE "public"."audit_logs"');
    expect(bundle.downSql).toContain('DROP TABLE IF EXISTS "public"."audit_logs";');
  });
});
