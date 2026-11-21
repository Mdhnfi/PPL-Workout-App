export interface ColumnMetadata {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
}

export interface IndexMetadata {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  index_method: string;
  index_definition: string;
  columns: string[];
}

export interface ForeignKeyMetadata {
  constraint_name: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
  update_rule: string;
  delete_rule: string;
}

export interface ConstraintMetadata {
  constraint_name: string;
  table_name: string;
  constraint_type: 'PRIMARY KEY' | 'UNIQUE' | 'CHECK';
  check_clause: string | null;
  columns: string[] | null;
}

export interface TableMetadata {
  tableName: string;
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
  constraints: ConstraintMetadata[];
}

export interface VersionInfo {
  hasVersionTable: boolean;
  comparisonMode: 'VERSION_TRACKED' | 'STRUCTURAL_FALLBACK';
  latestVersion: string | null;
  description: string | null;
  appliedAt: string | null;
}

export interface InspectedSchema {
  schema: string;
  availableSchemas: string[];
  versionInfo: VersionInfo;
  tables: Record<string, TableMetadata>;
  inspectedAt: string;
}

export interface ColumnModification {
  tableName: string;
  columnName: string;
  source: ColumnMetadata;
  target: ColumnMetadata;
  changes: Array<'TYPE' | 'NULLABILITY' | 'DEFAULT'>;
  isBreaking: boolean;
}

export interface DirectionalSchemaItems {
  tables: TableMetadata[];
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
  constraints: ConstraintMetadata[];
}

export type SemverBumpType = 'MAJOR' | 'MINOR' | 'PATCH' | 'NONE';

export interface VersionComparisonResult {
  mode: 'VERSION_TRACKED' | 'STRUCTURAL_FALLBACK';
  sourceVersion: string | null;
  targetVersion: string | null;
  newerSchema: 'SOURCE_A' | 'TARGET_B' | 'EQUAL' | 'UNKNOWN_STRUCTURAL_FALLBACK';
  bumpType: SemverBumpType;
  nextVersion: string;
  bumpReasons: string[];
}

export interface SchemaDiffReport {
  sourceSchemaName: string;
  targetSchemaName: string;
  aVsB: DirectionalSchemaItems;
  bVsA: DirectionalSchemaItems;
  modifiedColumns: ColumnModification[];
  versionAnalysis: VersionComparisonResult;
  hasDifferences: boolean;
}

export interface GeneratedMigrationBundle {
  version: string;
  bumpType: SemverBumpType;
  upSql: string;
  downSql: string;
  autoChangeLog: string;
  generatedAt: string;
}
