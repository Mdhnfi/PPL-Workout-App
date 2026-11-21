import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import {
  assertValidSchemaIdentifier,
  getReadOnlySequelize,
} from '@/lib/sequelizeManager';
import {
  analyzeExplainTree,
  detectSqlAntiPatterns,
  PostgresExplainNode,
  validateReadOnlySelectQuery,
} from '@/lib/queryAnalyzer';

interface AnalyzeQueryRequest {
  connectionUri: string;
  schemaName?: string;
  query: string;
  largeTableRowThreshold?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AnalyzeQueryRequest;

    if (!body?.connectionUri || !body?.query) {
      return NextResponse.json(
        { error: 'connectionUri and query are required.' },
        { status: 400 }
      );
    }

    const safeSelectSql = validateReadOnlySelectQuery(body.query);
    const targetSchema = assertValidSchemaIdentifier(body.schemaName || 'public');
    const largeTableThreshold = body.largeTableRowThreshold ?? 1000;

    const sequelize = await getReadOnlySequelize(body.connectionUri);

    const antiPatterns = detectSqlAntiPatterns(safeSelectSql);

    const tableStats = await sequelize.query<{
      table_name: string;
      estimated_rows: number;
    }>(
      `
      SELECT
        c.relname AS table_name,
        GREATEST(c.reltuples::bigint, 0) AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = :schema
        AND c.relkind = 'r';
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    const tableRowCounts: Record<string, number> = {};
    for (const row of tableStats) {
      tableRowCounts[row.table_name] = Number(row.estimated_rows ?? 0);
    }

    const explainRows = await sequelize.query<{
      'QUERY PLAN': Array<{ Plan: PostgresExplainNode }>;
    }>(`EXPLAIN (FORMAT JSON) ${safeSelectSql}`, {
      type: QueryTypes.SELECT,
    });

    const rawPlanRoot = explainRows[0]?.['QUERY PLAN']?.[0]?.Plan;
    if (!rawPlanRoot) {
      return NextResponse.json(
        { error: 'PostgreSQL did not return an execution plan.' },
        { status: 500 }
      );
    }

    const { simplifiedSteps, indexSuggestions } = analyzeExplainTree(
      rawPlanRoot,
      tableRowCounts,
      largeTableThreshold
    );

    const unusedIndexes = await sequelize.query<{
      table_name: string;
      index_name: string;
      idx_scan: number;
      index_size: string;
      index_definition: string;
    }>(
      `
      SELECT
        s.relname AS table_name,
        s.indexrelname AS index_name,
        s.idx_scan::int AS idx_scan,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
        pg_get_indexdef(s.indexrelid) AS index_definition
      FROM pg_stat_user_indexes s
      JOIN pg_index ix ON ix.indexrelid = s.indexrelid
      WHERE s.schemaname = :schema
        AND s.idx_scan = 0
        AND NOT ix.indisprimary
        AND NOT ix.indisunique
      ORDER BY pg_relation_size(s.indexrelid) DESC, s.relname, s.indexrelname;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    return NextResponse.json({
      schema: targetSchema,
      analyzedQuery: safeSelectSql,
      executionMode: 'EXPLAIN_PLAN_ONLY_NO_MUTATION',
      rawPlan: rawPlanRoot,
      simplifiedPlan: simplifiedSteps,
      antiPatterns,
      performanceSuggestions: {
        recommendedIndexes: indexSuggestions,
        unusedIndexes,
      },
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to analyze query execution plan.';
    const status =
      message.includes('blocked') ||
      message.includes('permitted') ||
      message.includes('violation')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
