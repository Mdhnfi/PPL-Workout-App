import {
  ColumnMetadata,
  GeneratedMigrationBundle,
  SchemaDiffReport,
  TableMetadata,
} from '@/types/schema';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function formatDdlColumnDefinition(col: ColumnMetadata): string {
  const defaultVal = col.column_default ?? '';
  const isSequenceBacked = defaultVal.startsWith('nextval(');

  let sqlType = col.udt_name.toUpperCase();
  if (isSequenceBacked && col.udt_name === 'int4') {
    sqlType = 'SERIAL';
  } else if (isSequenceBacked && col.udt_name === 'int8') {
    sqlType = 'BIGSERIAL';
  } else if (col.udt_name === 'varchar') {
    sqlType = col.character_maximum_length
      ? `VARCHAR(${col.character_maximum_length})`
      : 'VARCHAR';
  } else if (col.udt_name === 'bpchar') {
    sqlType = col.character_maximum_length
      ? `CHAR(${col.character_maximum_length})`
      : 'CHAR';
  } else if (col.udt_name === 'numeric') {
    sqlType = col.numeric_precision ? `NUMERIC(${col.numeric_precision})` : 'NUMERIC';
  } else if (col.udt_name === 'int4') {
    sqlType = 'INTEGER';
  } else if (col.udt_name === 'int8') {
    sqlType = 'BIGINT';
  } else if (col.udt_name === 'bool') {
    sqlType = 'BOOLEAN';
  }

  const parts = [quoteIdent(col.column_name), sqlType];

  if (col.is_nullable === 'NO') {
    parts.push('NOT NULL');
  }

  if (col.column_default && !isSequenceBacked) {
    parts.push(`DEFAULT ${col.column_default}`);
  }

  return parts.join(' ');
}

function buildCreateTableSql(targetSchema: string, table: TableMetadata): string {
  const lines: string[] = table.columns.map(
    (col) => `  ${formatDdlColumnDefinition(col)}`
  );

  for (const con of table.constraints) {
    if (con.constraint_type === 'PRIMARY KEY' && con.columns?.length) {
      lines.push(
        `  CONSTRAINT ${quoteIdent(con.constraint_name)} PRIMARY KEY (${con.columns.map(quoteIdent).join(', ')})`
      );
    } else if (con.constraint_type === 'UNIQUE' && con.columns?.length) {
      lines.push(
        `  CONSTRAINT ${quoteIdent(con.constraint_name)} UNIQUE (${con.columns.map(quoteIdent).join(', ')})`
      );
    } else if (con.constraint_type === 'CHECK' && con.check_clause) {
      lines.push(
        `  CONSTRAINT ${quoteIdent(con.constraint_name)} CHECK (${con.check_clause})`
      );
    }
  }

  return [
    `CREATE TABLE ${quoteIdent(targetSchema)}.${quoteIdent(table.tableName)} (`,
    lines.join(',\n'),
    `);`,
  ].join('\n');
}

export interface SqlGenerationOptions {
  includeDestructiveDrops?: boolean;
  recordVersionEntry?: boolean;
  customNotes?: string;
}

export function generateMigrationBundle(
  diff: SchemaDiffReport,
  options: SqlGenerationOptions = {}
): GeneratedMigrationBundle {
  const {
    includeDestructiveDrops = false,
    recordVersionEntry = diff.versionAnalysis.mode === 'VERSION_TRACKED',
    customNotes,
  } = options;

  const targetSchema = diff.targetSchemaName;
  const version = diff.versionAnalysis.nextVersion;
  const generatedAt = new Date().toISOString();

  const upLines: string[] = [
    `-- ============================================================================`,
    `-- MIGRATION UP SCRIPT: v${version} (${diff.versionAnalysis.bumpType})`,
    `-- Source Schema: ${diff.sourceSchemaName} -> Target Schema: ${targetSchema}`,
    `-- Generated At:  ${generatedAt}`,
    `-- SAFETY NOTICE:   Generated for review & GitHub commit only. Never auto-executed.`,
    `-- ============================================================================`,
    `BEGIN;`,
    ``,
  ];

  const downLines: string[] = [
    `-- ============================================================================`,
    `-- MIGRATION ROLLBACK (DOWN) SCRIPT: Revert v${version}`,
    `-- Target Schema: ${targetSchema}`,
    `-- Generated At:  ${generatedAt}`,
    `-- ============================================================================`,
    `BEGIN;`,
    ``,
  ];

  const constraintBackedIndexNames = new Set<string>();
  for (const tbl of diff.aVsB.tables) {
    for (const con of tbl.constraints) {
      constraintBackedIndexNames.add(con.constraint_name);
    }
  }
  for (const con of diff.aVsB.constraints) {
    constraintBackedIndexNames.add(con.constraint_name);
  }

  if (diff.aVsB.tables.length > 0) {
    upLines.push(`-- [1] Create Missing Tables`);
    for (const tbl of diff.aVsB.tables) {
      upLines.push(buildCreateTableSql(targetSchema, tbl));
      upLines.push('');

      for (const idx of tbl.indexes) {
        if (idx.is_primary || constraintBackedIndexNames.has(idx.index_name)) continue;
        const uniqueKw = idx.is_unique ? 'UNIQUE ' : '';
        upLines.push(
          `CREATE ${uniqueKw}INDEX ${quoteIdent(idx.index_name)} ON ${quoteIdent(targetSchema)}.${quoteIdent(tbl.tableName)} USING ${idx.index_method} (${idx.columns.map(quoteIdent).join(', ')});`
        );
      }

      for (const fk of tbl.foreignKeys) {
        upLines.push(
          `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(tbl.tableName)} ADD CONSTRAINT ${quoteIdent(fk.constraint_name)} FOREIGN KEY (${quoteIdent(fk.source_column)}) REFERENCES ${quoteIdent(targetSchema)}.${quoteIdent(fk.target_table)} (${quoteIdent(fk.target_column)}) ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};`
        );
      }
    }
    upLines.push('');
  }

  if (diff.aVsB.columns.length > 0) {
    upLines.push(`-- [2] Add Missing Columns`);
    for (const col of diff.aVsB.columns) {
      upLines.push(
        `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(col.table_name)} ADD COLUMN ${formatDdlColumnDefinition(col)};`
      );
    }
    upLines.push('');
  }

  if (diff.modifiedColumns.length > 0) {
    upLines.push(`-- [3] Alter Modified Columns`);
    for (const mod of diff.modifiedColumns) {
      const tblRef = `${quoteIdent(targetSchema)}.${quoteIdent(mod.tableName)}`;
      const colRef = quoteIdent(mod.columnName);

      if (mod.changes.includes('TYPE')) {
        const upType = formatDdlColumnDefinition(mod.source).split(' ')[1];
        upLines.push(`ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} TYPE ${upType};`);
      }
      if (mod.changes.includes('NULLABILITY')) {
        upLines.push(
          mod.source.is_nullable === 'NO'
            ? `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} SET NOT NULL;`
            : `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} DROP NOT NULL;`
        );
      }
      if (mod.changes.includes('DEFAULT')) {
        upLines.push(
          mod.source.column_default
            ? `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} SET DEFAULT ${mod.source.column_default};`
            : `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} DROP DEFAULT;`
        );
      }
    }
    upLines.push('');
  }

  if (diff.aVsB.constraints.length > 0 || diff.aVsB.foreignKeys.length > 0) {
    upLines.push(`-- [4] Add Missing Constraints & Foreign Keys`);
    for (const con of diff.aVsB.constraints) {
      const tblRef = `${quoteIdent(targetSchema)}.${quoteIdent(con.table_name)}`;
      if (con.constraint_type === 'UNIQUE' && con.columns?.length) {
        upLines.push(
          `ALTER TABLE ${tblRef} ADD CONSTRAINT ${quoteIdent(con.constraint_name)} UNIQUE (${con.columns.map(quoteIdent).join(', ')});`
        );
      } else if (con.constraint_type === 'CHECK' && con.check_clause) {
        upLines.push(
          `ALTER TABLE ${tblRef} ADD CONSTRAINT ${quoteIdent(con.constraint_name)} CHECK (${con.check_clause});`
        );
      }
    }

    for (const fk of diff.aVsB.foreignKeys) {
      upLines.push(
        `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(fk.source_table)} ADD CONSTRAINT ${quoteIdent(fk.constraint_name)} FOREIGN KEY (${quoteIdent(fk.source_column)}) REFERENCES ${quoteIdent(targetSchema)}.${quoteIdent(fk.target_table)} (${quoteIdent(fk.target_column)}) ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};`
      );
    }
    upLines.push('');
  }

  const standaloneNewIndexes = diff.aVsB.indexes.filter(
    (idx) => !idx.is_primary && !constraintBackedIndexNames.has(idx.index_name)
  );
  if (standaloneNewIndexes.length > 0) {
    upLines.push(`-- [5] Create Missing Indexes`);
    for (const idx of standaloneNewIndexes) {
      const uniqueKw = idx.is_unique ? 'UNIQUE ' : '';
      upLines.push(
        `CREATE ${uniqueKw}INDEX ${quoteIdent(idx.index_name)} ON ${quoteIdent(targetSchema)}.${quoteIdent(idx.table_name)} USING ${idx.index_method} (${idx.columns.map(quoteIdent).join(', ')});`
      );
    }
    upLines.push('');
  }

  if (diff.bVsA.columns.length > 0 || diff.bVsA.tables.length > 0) {
    upLines.push(
      `-- [6] Extra Objects in Target (${targetSchema}) Not Present in Source (${diff.sourceSchemaName})`
    );
    const prefix = includeDestructiveDrops ? '' : '-- [REVIEW BEFORE ENABLING] ';

    for (const col of diff.bVsA.columns) {
      upLines.push(
        `${prefix}ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(col.table_name)} DROP COLUMN ${quoteIdent(col.column_name)};`
      );
    }
    for (const tbl of diff.bVsA.tables) {
      upLines.push(
        `${prefix}DROP TABLE ${quoteIdent(targetSchema)}.${quoteIdent(tbl.tableName)};`
      );
    }
    upLines.push('');
  }

  if (standaloneNewIndexes.length > 0) {
    downLines.push(`-- [1] Drop Added Indexes`);
    for (const idx of [...standaloneNewIndexes].reverse()) {
      downLines.push(`DROP INDEX IF EXISTS ${quoteIdent(targetSchema)}.${quoteIdent(idx.index_name)};`);
    }
    downLines.push('');
  }

  if (diff.aVsB.foreignKeys.length > 0 || diff.aVsB.constraints.length > 0) {
    downLines.push(`-- [2] Drop Added Foreign Keys & Constraints`);
    for (const fk of [...diff.aVsB.foreignKeys].reverse()) {
      downLines.push(
        `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(fk.source_table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(fk.constraint_name)};`
      );
    }
    for (const con of [...diff.aVsB.constraints].reverse()) {
      downLines.push(
        `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(con.table_name)} DROP CONSTRAINT IF EXISTS ${quoteIdent(con.constraint_name)};`
      );
    }
    downLines.push('');
  }

  if (diff.modifiedColumns.length > 0) {
    downLines.push(`-- [3] Revert Modified Columns`);
    for (const mod of [...diff.modifiedColumns].reverse()) {
      const tblRef = `${quoteIdent(targetSchema)}.${quoteIdent(mod.tableName)}`;
      const colRef = quoteIdent(mod.columnName);

      if (mod.changes.includes('DEFAULT')) {
        downLines.push(
          mod.target.column_default
            ? `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} SET DEFAULT ${mod.target.column_default};`
            : `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} DROP DEFAULT;`
        );
      }
      if (mod.changes.includes('NULLABILITY')) {
        downLines.push(
          mod.target.is_nullable === 'NO'
            ? `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} SET NOT NULL;`
            : `ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} DROP NOT NULL;`
        );
      }
      if (mod.changes.includes('TYPE')) {
        const downType = formatDdlColumnDefinition(mod.target).split(' ')[1];
        downLines.push(`ALTER TABLE ${tblRef} ALTER COLUMN ${colRef} TYPE ${downType};`);
      }
    }
    downLines.push('');
  }

  if (diff.aVsB.columns.length > 0) {
    downLines.push(`-- [4] Drop Added Columns`);
    for (const col of [...diff.aVsB.columns].reverse()) {
      downLines.push(
        `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(col.table_name)} DROP COLUMN IF EXISTS ${quoteIdent(col.column_name)};`
      );
    }
    downLines.push('');
  }

  if (diff.aVsB.tables.length > 0) {
    downLines.push(`-- [5] Drop Created Tables`);
    for (const tbl of [...diff.aVsB.tables].reverse()) {
      downLines.push(
        `DROP TABLE IF EXISTS ${quoteIdent(targetSchema)}.${quoteIdent(tbl.tableName)};`
      );
    }
    downLines.push('');
  }

  const summaryNote = (
    customNotes ||
    diff.versionAnalysis.bumpReasons.join('; ') ||
    'Schema synchronization'
  ).replace(/'/g, "''");

  if (recordVersionEntry) {
    upLines.push(`-- Record Schema Version`);
    upLines.push(
      `INSERT INTO ${quoteIdent(targetSchema)}.schema_versions (version, description) VALUES ('${version}', '${summaryNote}');`
    );
    upLines.push('');

    downLines.push(`-- Remove Schema Version Record`);
    downLines.push(
      `DELETE FROM ${quoteIdent(targetSchema)}.schema_versions WHERE version = '${version}';`
    );
    downLines.push('');
  }

  upLines.push(`COMMIT;`);
  downLines.push(`COMMIT;`);

  const autoChangeLog = buildAutoChangeLog(diff, version, generatedAt, customNotes);

  return {
    version,
    bumpType: diff.versionAnalysis.bumpType,
    upSql: upLines.join('\n'),
    downSql: downLines.join('\n'),
    autoChangeLog,
    generatedAt,
  };
}

function buildAutoChangeLog(
  diff: SchemaDiffReport,
  version: string,
  generatedAt: string,
  customNotes?: string
): string {
  const lines: string[] = [
    `## Release v${version} (${diff.versionAnalysis.bumpType})`,
    `- **Generated:** ${generatedAt}`,
    `- **Comparison Mode:** ${diff.versionAnalysis.mode}`,
    `- **Source Schema (A):** \`${diff.sourceSchemaName}\` (${diff.versionAnalysis.sourceVersion ?? 'unversioned'})`,
    `- **Target Schema (B):** \`${diff.targetSchemaName}\` (${diff.versionAnalysis.targetVersion ?? 'unversioned'})`,
  ];

  if (customNotes?.trim()) {
    lines.push(`- **Author Notes:** ${customNotes.trim()}`);
  }

  lines.push('', '### Detected Changes (A vs B)');
  if (diff.versionAnalysis.bumpReasons.length === 0) {
    lines.push('- No structural differences detected.');
  } else {
    for (const reason of diff.versionAnalysis.bumpReasons) {
      lines.push(`- ${reason}`);
    }
  }

  if (
    diff.bVsA.tables.length > 0 ||
    diff.bVsA.columns.length > 0 ||
    diff.bVsA.indexes.length > 0
  ) {
    lines.push('', '### Extra Objects in Target (B vs A)');
    for (const t of diff.bVsA.tables) {
      lines.push(`- Table \`${t.tableName}\` exists in target but not in source.`);
    }
    for (const c of diff.bVsA.columns) {
      lines.push(`- Column \`${c.table_name}.${c.column_name}\` exists in target but not in source.`);
    }
    for (const i of diff.bVsA.indexes) {
      lines.push(`- Index \`${i.index_name}\` on \`${i.table_name}\` exists in target but not in source.`);
    }
  }

  return lines.join('\n');
}
