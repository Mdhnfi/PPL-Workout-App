import {
  ColumnMetadata,
  ColumnModification,
  DirectionalSchemaItems,
  InspectedSchema,
  SchemaDiffReport,
  SemverBumpType,
  VersionComparisonResult,
} from '@/types/schema';

const SYSTEM_METADATA_TABLES = new Set(['schema_versions']);

function parseSemver(version: string | null): [number, number, number] | null {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverTuples(
  a: [number, number, number],
  b: [number, number, number]
): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function incrementSemver(baseVersion: string | null, bump: SemverBumpType): string {
  const [major, minor, patch] = parseSemver(baseVersion) ?? [1, 0, 0];
  switch (bump) {
    case 'MAJOR':
      return `${major + 1}.0.0`;
    case 'MINOR':
      return `${major}.${minor + 1}.0`;
    case 'PATCH':
      return `${major}.${minor}.${patch + 1}`;
    case 'NONE':
    default:
      return `${major}.${minor}.${patch}`;
  }
}

export function normalizeColumnType(col: ColumnMetadata): string {
  const udt = col.udt_name.toLowerCase();
  if (udt === 'varchar') {
    return col.character_maximum_length
      ? `varchar(${col.character_maximum_length})`
      : 'varchar';
  }
  if (udt === 'bpchar') {
    return col.character_maximum_length
      ? `char(${col.character_maximum_length})`
      : 'char';
  }
  if (udt === 'numeric') {
    return col.numeric_precision ? `numeric(${col.numeric_precision})` : 'numeric';
  }
  return udt;
}

function normalizeDefault(val: string | null): string {
  if (!val) return '';
  return val.replace(/::[a-zA-Z0-9_ ]+/g, '').trim();
}

function isBreakingColumnChange(source: ColumnMetadata, target: ColumnMetadata): boolean {
  if (target.is_nullable === 'YES' && source.is_nullable === 'NO' && !source.column_default) {
    return true;
  }

  if (
    source.character_maximum_length !== null &&
    target.character_maximum_length !== null &&
    source.character_maximum_length < target.character_maximum_length
  ) {
    return true;
  }

  if (source.udt_name !== target.udt_name) {
    const safeWidenings = new Set([
      'int2->int4',
      'int2->int8',
      'int4->int8',
      'float4->float8',
      'varchar->text',
    ]);
    if (!safeWidenings.has(`${target.udt_name}->${source.udt_name}`)) {
      return true;
    }
  }

  return false;
}

export function compareInspectedSchemas(
  schemaA: InspectedSchema,
  schemaB: InspectedSchema
): SchemaDiffReport {
  const aVsB: DirectionalSchemaItems = {
    tables: [],
    columns: [],
    indexes: [],
    foreignKeys: [],
    constraints: [],
  };

  const bVsA: DirectionalSchemaItems = {
    tables: [],
    columns: [],
    indexes: [],
    foreignKeys: [],
    constraints: [],
  };

  const modifiedColumns: ColumnModification[] = [];

  const tablesA = Object.keys(schemaA.tables).filter((t) => !SYSTEM_METADATA_TABLES.has(t));
  const tablesB = Object.keys(schemaB.tables).filter((t) => !SYSTEM_METADATA_TABLES.has(t));
  const setA = new Set(tablesA);
  const setB = new Set(tablesB);

  for (const tableName of tablesA) {
    if (!setB.has(tableName)) {
      aVsB.tables.push(schemaA.tables[tableName]);
    }
  }

  for (const tableName of tablesB) {
    if (!setA.has(tableName)) {
      bVsA.tables.push(schemaB.tables[tableName]);
    }
  }

  for (const tableName of tablesA) {
    if (!setB.has(tableName)) continue;

    const tblA = schemaA.tables[tableName];
    const tblB = schemaB.tables[tableName];

    const colsAMap = new Map(tblA.columns.map((c) => [c.column_name, c]));
    const colsBMap = new Map(tblB.columns.map((c) => [c.column_name, c]));

    for (const [colName, colA] of colsAMap) {
      const colB = colsBMap.get(colName);
      if (!colB) {
        aVsB.columns.push(colA);
      } else {
        const changes: Array<'TYPE' | 'NULLABILITY' | 'DEFAULT'> = [];
        if (normalizeColumnType(colA) !== normalizeColumnType(colB)) {
          changes.push('TYPE');
        }
        if (colA.is_nullable !== colB.is_nullable) {
          changes.push('NULLABILITY');
        }
        if (normalizeDefault(colA.column_default) !== normalizeDefault(colB.column_default)) {
          changes.push('DEFAULT');
        }

        if (changes.length > 0) {
          modifiedColumns.push({
            tableName,
            columnName: colName,
            source: colA,
            target: colB,
            changes,
            isBreaking: isBreakingColumnChange(colA, colB),
          });
        }
      }
    }

    for (const [colName, colB] of colsBMap) {
      if (!colsAMap.has(colName)) {
        bVsA.columns.push(colB);
      }
    }

    const idxANames = new Set(tblA.indexes.map((i) => i.index_name));
    const idxBNames = new Set(tblB.indexes.map((i) => i.index_name));

    for (const idxA of tblA.indexes) {
      if (!idxBNames.has(idxA.index_name)) {
        aVsB.indexes.push(idxA);
      }
    }
    for (const idxB of tblB.indexes) {
      if (!idxANames.has(idxB.index_name)) {
        bVsA.indexes.push(idxB);
      }
    }

    const fkANames = new Set(tblA.foreignKeys.map((fk) => fk.constraint_name));
    const fkBNames = new Set(tblB.foreignKeys.map((fk) => fk.constraint_name));

    for (const fkA of tblA.foreignKeys) {
      if (!fkBNames.has(fkA.constraint_name)) {
        aVsB.foreignKeys.push(fkA);
      }
    }
    for (const fkB of tblB.foreignKeys) {
      if (!fkANames.has(fkB.constraint_name)) {
        bVsA.foreignKeys.push(fkB);
      }
    }

    const conANames = new Set(tblA.constraints.map((c) => c.constraint_name));
    const conBNames = new Set(tblB.constraints.map((c) => c.constraint_name));

    for (const conA of tblA.constraints) {
      if (!conBNames.has(conA.constraint_name)) {
        aVsB.constraints.push(conA);
      }
    }
    for (const conB of tblB.constraints) {
      if (!conANames.has(conB.constraint_name)) {
        bVsA.constraints.push(conB);
      }
    }
  }

  const versionAnalysis = evaluateVersionAndBump(
    schemaA,
    schemaB,
    aVsB,
    bVsA,
    modifiedColumns
  );

  const hasDifferences =
    aVsB.tables.length > 0 ||
    bVsA.tables.length > 0 ||
    aVsB.columns.length > 0 ||
    bVsA.columns.length > 0 ||
    aVsB.indexes.length > 0 ||
    bVsA.indexes.length > 0 ||
    aVsB.foreignKeys.length > 0 ||
    bVsA.foreignKeys.length > 0 ||
    aVsB.constraints.length > 0 ||
    bVsA.constraints.length > 0 ||
    modifiedColumns.length > 0;

  return {
    sourceSchemaName: schemaA.schema,
    targetSchemaName: schemaB.schema,
    aVsB,
    bVsA,
    modifiedColumns,
    versionAnalysis,
    hasDifferences,
  };
}

function evaluateVersionAndBump(
  schemaA: InspectedSchema,
  schemaB: InspectedSchema,
  aVsB: DirectionalSchemaItems,
  bVsA: DirectionalSchemaItems,
  modifiedColumns: ColumnModification[]
): VersionComparisonResult {
  const bothHaveVersionTables =
    schemaA.versionInfo.hasVersionTable && schemaB.versionInfo.hasVersionTable;

  const semverA = parseSemver(schemaA.versionInfo.latestVersion);
  const semverB = parseSemver(schemaB.versionInfo.latestVersion);

  let newerSchema: VersionComparisonResult['newerSchema'] = 'UNKNOWN_STRUCTURAL_FALLBACK';
  if (bothHaveVersionTables && semverA && semverB) {
    const cmp = compareSemverTuples(semverA, semverB);
    if (cmp === 1) newerSchema = 'SOURCE_A';
    else if (cmp === -1) newerSchema = 'TARGET_B';
    else newerSchema = 'EQUAL';
  }

  const bumpReasons: string[] = [];
  let bumpType: SemverBumpType = 'NONE';

  const promoteBump = (candidate: SemverBumpType, reason: string) => {
    bumpReasons.push(reason);
    const rank: Record<SemverBumpType, number> = {
      NONE: 0,
      PATCH: 1,
      MINOR: 2,
      MAJOR: 3,
    };
    if (rank[candidate] > rank[bumpType]) {
      bumpType = candidate;
    }
  };

  if (bVsA.tables.length > 0) {
    promoteBump(
      'MAJOR',
      `Drops ${bVsA.tables.length} table(s) present in target (${bVsA.tables.map((t) => t.tableName).join(', ')})`
    );
  }
  if (bVsA.columns.length > 0) {
    promoteBump(
      'MAJOR',
      `Drops ${bVsA.columns.length} column(s) present in target (${bVsA.columns.map((c) => `${c.table_name}.${c.column_name}`).join(', ')})`
    );
  }
  const breakingMods = modifiedColumns.filter((m) => m.isBreaking);
  if (breakingMods.length > 0) {
    promoteBump(
      'MAJOR',
      `Breaking column alteration(s) on ${breakingMods.map((m) => `${m.tableName}.${m.columnName}`).join(', ')}`
    );
  }
  const droppedUniqueOrPk = bVsA.constraints.filter(
    (c) => c.constraint_type === 'PRIMARY KEY' || c.constraint_type === 'UNIQUE'
  );
  if (droppedUniqueOrPk.length > 0) {
    promoteBump(
      'MAJOR',
      `Drops ${droppedUniqueOrPk.length} PRIMARY KEY / UNIQUE constraint(s)`
    );
  }

  if (aVsB.tables.length > 0) {
    promoteBump(
      'MINOR',
      `Adds ${aVsB.tables.length} new table(s) (${aVsB.tables.map((t) => t.tableName).join(', ')})`
    );
  }
  if (aVsB.columns.length > 0) {
    promoteBump(
      'MINOR',
      `Adds ${aVsB.columns.length} new column(s) (${aVsB.columns.map((c) => `${c.table_name}.${c.column_name}`).join(', ')})`
    );
  }
  if (aVsB.foreignKeys.length > 0) {
    promoteBump('MINOR', `Adds ${aVsB.foreignKeys.length} foreign key relationship(s)`);
  }
  if (aVsB.constraints.length > 0) {
    promoteBump('MINOR', `Adds ${aVsB.constraints.length} table constraint(s)`);
  }

  if (aVsB.indexes.length > 0 || bVsA.indexes.length > 0) {
    promoteBump(
      'PATCH',
      `Modifies indexes (+${aVsB.indexes.length} / -${bVsA.indexes.length})`
    );
  }
  const nonBreakingMods = modifiedColumns.filter((m) => !m.isBreaking);
  if (nonBreakingMods.length > 0) {
    promoteBump(
      'PATCH',
      `Non-breaking column refinement(s) on ${nonBreakingMods.map((m) => `${m.tableName}.${m.columnName}`).join(', ')}`
    );
  }

  let baseVersion = schemaB.versionInfo.latestVersion ?? schemaA.versionInfo.latestVersion;
  if (semverA && semverB && compareSemverTuples(semverA, semverB) === 1) {
    baseVersion = schemaA.versionInfo.latestVersion;
  }

  const nextVersion = incrementSemver(baseVersion, bumpType);

  return {
    mode: bothHaveVersionTables ? 'VERSION_TRACKED' : 'STRUCTURAL_FALLBACK',
    sourceVersion: schemaA.versionInfo.latestVersion,
    targetVersion: schemaB.versionInfo.latestVersion,
    newerSchema,
    bumpType,
    nextVersion,
    bumpReasons,
  };
}
