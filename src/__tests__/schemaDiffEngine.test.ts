import { describe, expect, it } from 'vitest';
import { compareInspectedSchemas } from '@/lib/schemaDiffEngine';
import { makeColumn, makeSchema, makeTable } from './fixtures/mockSchemas';

describe('schemaDiffEngine - Version Detection & Structural Fallback', () => {
  it('detects version tables on both schemas and identifies Source A as newer', () => {
    const schemaA = makeSchema('public', '1.3.0', {
      users: makeTable('users'),
    });
    const schemaB = makeSchema('public', '1.1.0', {
      users: makeTable('users'),
    });

    const report = compareInspectedSchemas(schemaA, schemaB);

    expect(report.versionAnalysis.mode).toBe('VERSION_TRACKED');
    expect(report.versionAnalysis.sourceVersion).toBe('1.3.0');
    expect(report.versionAnalysis.targetVersion).toBe('1.1.0');
    expect(report.versionAnalysis.newerSchema).toBe('SOURCE_A');
  });

  it('switches to STRUCTURAL_FALLBACK when either schema lacks a version control table', () => {
    const versionedA = makeSchema('public', '1.2.0', {
      users: makeTable('users'),
    });
    const unversionedB = makeSchema('auth', null, {
      users: makeTable('users'),
      roles: makeTable('roles'),
    });

    const report = compareInspectedSchemas(versionedA, unversionedB);

    expect(report.versionAnalysis.mode).toBe('STRUCTURAL_FALLBACK');
    expect(report.versionAnalysis.newerSchema).toBe('UNKNOWN_STRUCTURAL_FALLBACK');
    expect(report.bVsA.tables.map((t) => t.tableName)).toEqual(['roles']);
  });
});

describe('schemaDiffEngine - SemVer Bumps', () => {
  it('classifies additive changes as MINOR', () => {
    const schemaA = makeSchema('public', '1.3.0', {
      users: makeTable('users'),
      audit_logs: makeTable('audit_logs'),
    });
    const schemaB = makeSchema('public', '1.1.0', {
      users: makeTable('users'),
    });

    const report = compareInspectedSchemas(schemaA, schemaB);
    expect(report.versionAnalysis.bumpType).toBe('MINOR');
    expect(report.versionAnalysis.nextVersion).toBe('1.4.0');
  });

  it('classifies destructive/breaking changes as MAJOR', () => {
    const schemaA = makeSchema('public', '1.2.0', {
      users: makeTable('users'),
    });
    const schemaB = makeSchema('public', '1.2.0', {
      users: makeTable('users'),
      deprecated_sessions: makeTable('deprecated_sessions'),
    });

    const report = compareInspectedSchemas(schemaA, schemaB);
    expect(report.versionAnalysis.bumpType).toBe('MAJOR');
    expect(report.versionAnalysis.nextVersion).toBe('2.0.0');
  });

  it('classifies index-only changes as PATCH', () => {
    const schemaA = makeSchema('public', '1.1.2', {
      users: makeTable('users', {
        columns: [
          ...makeTable('users').columns,
          makeColumn('users', 'bio', { ordinal_position: 2, character_maximum_length: 255 }),
        ],
      }),
    });
    const schemaB = makeSchema('public', '1.1.2', {
      users: makeTable('users', {
        columns: [
          ...makeTable('users').columns,
          makeColumn('users', 'bio', { ordinal_position: 2, character_maximum_length: 100 }),
        ],
      }),
    });

    const report = compareInspectedSchemas(schemaA, schemaB);
    expect(report.versionAnalysis.bumpType).toBe('PATCH');
    expect(report.versionAnalysis.nextVersion).toBe('1.1.3');
  });
});
