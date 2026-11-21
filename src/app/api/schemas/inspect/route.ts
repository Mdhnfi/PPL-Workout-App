import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import {
  assertValidSchemaIdentifier,
  getReadOnlySequelize,
} from '@/lib/sequelizeManager';

interface InspectRequestBody {
  connectionUri: string;
  schemaName?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InspectRequestBody;

    if (!body?.connectionUri) {
      return NextResponse.json(
        { error: 'connectionUri is required.' },
        { status: 400 }
      );
    }

    const targetSchema = assertValidSchemaIdentifier(body.schemaName || 'public');
    const sequelize = await getReadOnlySequelize(body.connectionUri);

    const availableSchemas = await sequelize.query<{ schema_name: string }>(
      `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND schema_name NOT LIKE 'pg_temp_%'
        AND schema_name NOT LIKE 'pg_toast_temp_%'
      ORDER BY schema_name;
      `,
      { type: QueryTypes.SELECT }
    );

    const [versionTableCheck] = await sequelize.query<{ has_version_table: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = :schema
          AND table_name = 'schema_versions'
      ) AS has_version_table;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    let versionInfo: {
      hasVersionTable: boolean;
      comparisonMode: 'VERSION_TRACKED' | 'STRUCTURAL_FALLBACK';
      latestVersion: string | null;
      description: string | null;
      appliedAt: string | null;
    } = {
      hasVersionTable: false,
      comparisonMode: 'STRUCTURAL_FALLBACK',
      latestVersion: null,
      description: null,
      appliedAt: null,
    };

    if (versionTableCheck?.has_version_table) {
      const latestRows = await sequelize.query<{
        version: string;
        description: string;
        applied_at: string;
      }>(
        `
        SELECT version, description, applied_at
        FROM "${targetSchema}".schema_versions
        ORDER BY applied_at DESC, id DESC
        LIMIT 1;
        `,
        { type: QueryTypes.SELECT }
      );

      const latest = latestRows[0];
      versionInfo = {
        hasVersionTable: true,
        comparisonMode: 'VERSION_TRACKED',
        latestVersion: latest?.version ?? null,
        description: latest?.description ?? null,
        appliedAt: latest?.applied_at ?? null,
      };
    }

    const columns = await sequelize.query<{
      table_name: string;
      column_name: string;
      ordinal_position: number;
      data_type: string;
      udt_name: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>(
      `
      SELECT
        t.table_name,
        c.column_name,
        c.ordinal_position,
        c.data_type,
        c.udt_name,
        c.character_maximum_length,
        c.numeric_precision,
        c.is_nullable,
        c.column_default
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
      WHERE t.table_schema = :schema
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    const indexes = await sequelize.query<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      is_primary: boolean;
      index_method: string;
      index_definition: string;
      columns: string[];
    }>(
      `
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        am.amname AS index_method,
        pg_get_indexdef(ix.indexrelid) AS index_definition,
        ARRAY(
          SELECT a.attname
          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          ORDER BY k.ord
        ) AS columns
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      WHERE n.nspname = :schema
        AND t.relkind = 'r'
      ORDER BY t.relname, i.relname;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    const foreignKeys = await sequelize.query<{
      constraint_name: string;
      source_table: string;
      source_column: string;
      target_schema: string;
      target_table: string;
      target_column: string;
      update_rule: string;
      delete_rule: string;
    }>(
      `
      SELECT
        tc.constraint_name,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_schema AS target_schema,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
       AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = :schema
      ORDER BY tc.table_name, tc.constraint_name;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    const constraints = await sequelize.query<{
      constraint_name: string;
      table_name: string;
      constraint_type: 'PRIMARY KEY' | 'UNIQUE' | 'CHECK';
      check_clause: string | null;
      columns: string[] | null;
    }>(
      `
      SELECT
        tc.constraint_name,
        tc.table_name,
        tc.constraint_type,
        cc.check_clause,
        ARRAY_AGG(kcu.column_name ORDER BY kcu.ordinal_position)
          FILTER (WHERE kcu.column_name IS NOT NULL) AS columns
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
       AND tc.constraint_schema = cc.constraint_schema
      WHERE tc.table_schema = :schema
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'CHECK')
        AND tc.constraint_name NOT LIKE '%_not_null'
      GROUP BY tc.constraint_name, tc.table_name, tc.constraint_type, cc.check_clause
      ORDER BY tc.table_name, tc.constraint_name;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    const tablesMap: Record<string, {
      tableName: string;
      columns: typeof columns;
      indexes: typeof indexes;
      foreignKeys: typeof foreignKeys;
      constraints: typeof constraints;
    }> = {};

    for (const col of columns) {
      if (!tablesMap[col.table_name]) {
        tablesMap[col.table_name] = {
          tableName: col.table_name,
          columns: [],
          indexes: [],
          foreignKeys: [],
          constraints: [],
        };
      }
      tablesMap[col.table_name].columns.push(col);
    }

    for (const idx of indexes) {
      tablesMap[idx.table_name]?.indexes.push(idx);
    }
    for (const fk of foreignKeys) {
      tablesMap[fk.source_table]?.foreignKeys.push(fk);
    }
    for (const con of constraints) {
      tablesMap[con.table_name]?.constraints.push(con);
    }

    return NextResponse.json({
      schema: targetSchema,
      availableSchemas: availableSchemas.map((s) => s.schema_name),
      versionInfo,
      tables: tablesMap,
      inspectedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to inspect database schema.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
