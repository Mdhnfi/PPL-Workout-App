import {
  ColumnMetadata,
  InspectedSchema,
  TableMetadata,
} from '@/types/schema';

export function makeColumn(
  tableName: string,
  columnName: string,
  overrides: Partial<ColumnMetadata> = {}
): ColumnMetadata {
  return {
    table_name: tableName,
    column_name: columnName,
    ordinal_position: 1,
    data_type: 'character varying',
    udt_name: 'varchar',
    character_maximum_length: 100,
    numeric_precision: null,
    is_nullable: 'YES',
    column_default: null,
    ...overrides,
  };
}

export function makeTable(
  tableName: string,
  overrides: Partial<TableMetadata> = {}
): TableMetadata {
  return {
    tableName,
    columns: [
      makeColumn(tableName, 'id', {
        ordinal_position: 1,
        data_type: 'integer',
        udt_name: 'int4',
        character_maximum_length: null,
        is_nullable: 'NO',
        column_default: `nextval('${tableName}_id_seq'::regclass)`,
      }),
    ],
    indexes: [
      {
        table_name: tableName,
        index_name: `${tableName}_pkey`,
        is_unique: true,
        is_primary: true,
        index_method: 'btree',
        index_definition: `CREATE UNIQUE INDEX ${tableName}_pkey ON public.${tableName} USING btree (id)`,
        columns: ['id'],
      },
    ],
    foreignKeys: [],
    constraints: [
      {
        constraint_name: `${tableName}_pkey`,
        table_name: tableName,
        constraint_type: 'PRIMARY KEY',
        check_clause: null,
        columns: ['id'],
      },
    ],
    ...overrides,
  };
}

export function makeSchema(
  schemaName: string,
  version: string | null,
  tables: Record<string, TableMetadata>
): InspectedSchema {
  const hasVersionTable = version !== null;
  return {
    schema: schemaName,
    availableSchemas: [schemaName],
    versionInfo: {
      hasVersionTable,
      comparisonMode: hasVersionTable ? 'VERSION_TRACKED' : 'STRUCTURAL_FALLBACK',
      latestVersion: version,
      description: hasVersionTable ? `Release ${version}` : null,
      appliedAt: hasVersionTable ? '2026-11-20T08:00:00.000Z' : null,
    },
    tables,
    inspectedAt: '2026-11-22T00:00:00.000Z',
  };
}
