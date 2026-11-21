import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import {
  assertValidSchemaIdentifier,
  getReadOnlySequelize,
} from '@/lib/sequelizeManager';

interface HealthMonitorRequest {
  connectionUri: string;
  schemaName?: string;
  longRunningThresholdMs?: number;
}

interface ScoreBreakdown {
  overallScore: number;
  grade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'CRITICAL';
  factors: {
    cacheHitScore: number;
    indexEfficiencyScore: number;
    bloatHealthScore: number;
    queryLatencyScore: number;
    activeContentionScore: number;
  };
}

function computePerformanceScore(params: {
  cacheHitRatio: number;
  avgIndexUsageRatio: number;
  avgDeadTupleRatio: number;
  meanQueryExecMs: number;
  longRunningCount: number;
}): ScoreBreakdown {
  const cacheHitScore = Math.round(
    Math.min(25, Math.max(0, ((params.cacheHitRatio - 80) / 20) * 25))
  );

  const indexEfficiencyScore = Math.round(
    Math.min(25, Math.max(0, (params.avgIndexUsageRatio / 100) * 25))
  );

  const bloatPenalty = Math.min(20, (params.avgDeadTupleRatio / 20) * 20);
  const bloatHealthScore = Math.round(Math.max(0, 20 - bloatPenalty));

  const latencyPenalty = Math.min(15, (params.meanQueryExecMs / 250) * 15);
  const queryLatencyScore = Math.round(Math.max(0, 15 - latencyPenalty));

  const activeContentionScore = Math.max(0, 15 - params.longRunningCount * 5);

  const overallScore =
    cacheHitScore +
    indexEfficiencyScore +
    bloatHealthScore +
    queryLatencyScore +
    activeContentionScore;

  let grade: ScoreBreakdown['grade'] = 'CRITICAL';
  if (overallScore >= 85) grade = 'EXCELLENT';
  else if (overallScore >= 70) grade = 'GOOD';
  else if (overallScore >= 50) grade = 'FAIR';

  return {
    overallScore,
    grade,
    factors: {
      cacheHitScore,
      indexEfficiencyScore,
      bloatHealthScore,
      queryLatencyScore,
      activeContentionScore,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as HealthMonitorRequest;

    if (!body?.connectionUri) {
      return NextResponse.json(
        { error: 'connectionUri is required.' },
        { status: 400 }
      );
    }

    const targetSchema = assertValidSchemaIdentifier(body.schemaName || 'public');
    const longRunningThresholdMs = body.longRunningThresholdMs ?? 2000;
    const captureTime = new Date().toISOString();

    const sequelize = await getReadOnlySequelize(body.connectionUri);

    const [dbHealth] = await sequelize.query<{
      database_name: string;
      database_size: string;
      database_size_bytes: number;
      active_connections: number;
      cache_hit_ratio: number;
      xact_commit: number;
      xact_rollback: number;
      deadlocks: number;
    }>(
      `
      SELECT
        d.datname AS database_name,
        pg_size_pretty(pg_database_size(d.datname)) AS database_size,
        pg_database_size(d.datname)::bigint AS database_size_bytes,
        d.numbackends::int AS active_connections,
        CASE
          WHEN (d.blks_hit + d.blks_read) = 0 THEN 100.0
          ELSE ROUND((d.blks_hit::numeric / (d.blks_hit + d.blks_read)) * 100, 2)
        END::float AS cache_hit_ratio,
        d.xact_commit::bigint AS xact_commit,
        d.xact_rollback::bigint AS xact_rollback,
        d.deadlocks::int AS deadlocks
      FROM pg_stat_database d
      WHERE d.datname = current_database();
      `,
      { type: QueryTypes.SELECT }
    );

    const tableHealth = await sequelize.query<{
      table_name: string;
      total_size: string;
      live_tuples: number;
      dead_tuples: number;
      dead_tuple_ratio: number;
      seq_scan: number;
      idx_scan: number;
      index_usage_ratio: number;
      last_autovacuum: string | null;
      last_autoanalyze: string | null;
    }>(
      `
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        n_live_tup::bigint AS live_tuples,
        n_dead_tup::bigint AS dead_tuples,
        CASE
          WHEN (n_live_tup + n_dead_tup) = 0 THEN 0.0
          ELSE ROUND((n_dead_tup::numeric / (n_live_tup + n_dead_tup)) * 100, 2)
        END::float AS dead_tuple_ratio,
        COALESCE(seq_scan, 0)::bigint AS seq_scan,
        COALESCE(idx_scan, 0)::bigint AS idx_scan,
        CASE
          WHEN (COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0)) = 0 THEN 100.0
          ELSE ROUND((COALESCE(idx_scan, 0)::numeric / (COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0))) * 100, 2)
        END::float AS index_usage_ratio,
        last_autovacuum,
        last_autoanalyze
      FROM pg_stat_user_tables
      WHERE schemaname = :schema
      ORDER BY n_live_tup DESC, relname;
      `,
      {
        replacements: { schema: targetSchema },
        type: QueryTypes.SELECT,
      }
    );

    const longRunningQueries = await sequelize.query<{
      pid: number;
      username: string;
      application_name: string;
      state: string;
      wait_event_type: string | null;
      duration_ms: number;
      query: string;
      query_start: string;
    }>(
      `
      SELECT
        pid,
        usename AS username,
        COALESCE(application_name, 'unknown') AS application_name,
        state,
        wait_event_type,
        ROUND(EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000, 2)::float AS duration_ms,
        query,
        query_start
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND pid <> pg_backend_pid()
        AND query_start IS NOT NULL
        AND EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000 >= :thresholdMs
      ORDER BY duration_ms DESC;
      `,
      {
        replacements: { thresholdMs: longRunningThresholdMs },
        type: QueryTypes.SELECT,
      }
    );

    const [extCheck] = await sequelize.query<{ installed: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
      ) AS installed;
      `,
      { type: QueryTypes.SELECT }
    );

    let historicalQueries: Array<{
      queryId: string;
      query: string;
      calls: number;
      exec_time_ms: number;
      total_exec_time_ms: number;
      rows_returned: number;
      capture_time: string;
    }> = [];

    if (extCheck?.installed) {
      try {
        const rows = await sequelize.query<{
          queryid: string;
          query: string;
          calls: number;
          mean_exec_time: number;
          total_exec_time: number;
          rows: number;
        }>(
          `
          SELECT
            queryid::text AS queryid,
            query,
            calls::bigint AS calls,
            ROUND(mean_exec_time::numeric, 3)::float AS mean_exec_time,
            ROUND(total_exec_time::numeric, 3)::float AS total_exec_time,
            rows::bigint AS rows
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND query NOT ILIKE '%pg_stat_%'
            AND query NOT ILIKE '%information_schema%'
          ORDER BY total_exec_time DESC
          LIMIT 25;
          `,
          { type: QueryTypes.SELECT }
        );

        historicalQueries = rows.map((r) => ({
          queryId: r.queryid,
          query: r.query,
          calls: Number(r.calls),
          exec_time_ms: Number(r.mean_exec_time),
          total_exec_time_ms: Number(r.total_exec_time),
          rows_returned: Number(r.rows),
          capture_time: captureTime,
        }));
      } catch {
        historicalQueries = [];
      }
    }

    const avgIndexUsageRatio =
      tableHealth.length > 0
        ? tableHealth.reduce((acc, t) => acc + Number(t.index_usage_ratio), 0) /
          tableHealth.length
        : 100;

    const avgDeadTupleRatio =
      tableHealth.length > 0
        ? tableHealth.reduce((acc, t) => acc + Number(t.dead_tuple_ratio), 0) /
          tableHealth.length
        : 0;

    const meanQueryExecMs =
      historicalQueries.length > 0
        ? historicalQueries.reduce((acc, q) => acc + q.exec_time_ms, 0) /
          historicalQueries.length
        : 0;

    const performanceScore = computePerformanceScore({
      cacheHitRatio: Number(dbHealth?.cache_hit_ratio ?? 100),
      avgIndexUsageRatio,
      avgDeadTupleRatio,
      meanQueryExecMs,
      longRunningCount: longRunningQueries.length,
    });

    return NextResponse.json({
      schema: targetSchema,
      capturedAt: captureTime,
      databaseHealth: dbHealth,
      tableHealth,
      longRunningQueries,
      performanceScore,
      historicalQueries,
      pgStatStatementsAvailable: Boolean(extCheck?.installed),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to retrieve PostgreSQL health metrics.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
