export interface AntiPatternWarning {
  code: 'SELECT_STAR' | 'MISSING_WHERE' | 'EXCESSIVE_JOINS' | 'UNNECESSARY_DISTINCT';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  recommendation: string;
}

export interface SimplifiedPlanNode {
  step: number;
  depth: number;
  nodeType: string;
  relationName?: string;
  alias?: string;
  startupCost: number;
  totalCost: number;
  estimatedRows: number;
  plainEnglish: string;
  isBottleneck: boolean;
}

export interface IndexSuggestion {
  tableName: string;
  estimatedRows: number;
  filterCondition: string;
  suggestedColumns: string[];
  suggestedSql: string;
  reason: string;
}

export interface PostgresExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Schema'?: string;
  'Alias'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  'Filter'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  'Merge Cond'?: string;
  'Join Type'?: string;
  'Sort Key'?: string[];
  'Plans'?: PostgresExplainNode[];
}

function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function validateReadOnlySelectQuery(rawSql: string): string {
  const trimmed = rawSql.trim();
  if (!trimmed) {
    throw new Error('SQL query cannot be empty.');
  }

  const sanitized = stripCommentsAndStrings(trimmed).trim();

  const withoutTrailingSemi = sanitized.replace(/;\s*$/, '');
  if (withoutTrailingSemi.includes(';')) {
    throw new Error(
      'Multiple SQL statements are blocked. Submit a single SELECT query.'
    );
  }

  if (!/^(SELECT|WITH)\b/i.test(withoutTrailingSemi)) {
    throw new Error(
      'Only read-only SELECT queries are permitted for execution plan analysis.'
    );
  }

  const forbiddenKeywords =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|UPSERT|GRANT|REVOKE|COPY|EXECUTE|CALL|VACUUM|ANALYZE|LOCK)\b/i;

  const forbiddenMatch = withoutTrailingSemi.match(forbiddenKeywords);
  if (forbiddenMatch) {
    throw new Error(
      `Read-only safety violation: Keyword "${forbiddenMatch[1].toUpperCase()}" is forbidden.`
    );
  }

  return trimmed.replace(/;\s*$/, '');
}

export function detectSqlAntiPatterns(rawSql: string): AntiPatternWarning[] {
  const warnings: AntiPatternWarning[] = [];
  const normalized = stripCommentsAndStrings(rawSql)
    .replace(/\s+/g, ' ')
    .trim();

  const withoutCountStar = normalized.replace(/\bCOUNT\s*\(\s*\*\s*\)/gi, 'COUNT(1)');
  if (/\bSELECT\s+(?:DISTINCT\s+)?(?:\w+\.)?\*/i.test(withoutCountStar)) {
    warnings.push({
      code: 'SELECT_STAR',
      severity: 'MEDIUM',
      title: 'Wildcard Column Selection (SELECT *)',
      description:
        'Selecting all columns transfers unnecessary data over the network, increases memory usage, and prevents Index-Only Scans.',
      recommendation:
        'Explicitly list only the required columns (e.g., SELECT id, email, status FROM ...).',
    });
  }

  const hasFrom = /\bFROM\b/i.test(normalized);
  const hasWhere = /\bWHERE\b/i.test(normalized);
  const hasLimit = /\bLIMIT\b/i.test(normalized);
  if (hasFrom && !hasWhere && !hasLimit) {
    warnings.push({
      code: 'MISSING_WHERE',
      severity: 'HIGH',
      title: 'Missing WHERE Clause (Unbounded Table Read)',
      description:
        'Query reads rows from the table without a WHERE filter or LIMIT, forcing PostgreSQL to scan the entire relation.',
      recommendation:
        'Add a selective WHERE predicate on indexed columns or apply a LIMIT clause for pagination.',
    });
  }

  const joinMatches = normalized.match(/\bJOIN\b/gi) ?? [];
  if (joinMatches.length >= 4) {
    warnings.push({
      code: 'EXCESSIVE_JOINS',
      severity: 'HIGH',
      title: `Excessive Table Joins (${joinMatches.length} JOINs Detected)`,
      description:
        'Joining 4 or more tables multiplies planner join-order combinations and increases the risk of expensive Nested Loop or Hash Join spills.',
      recommendation:
        'Verify all joined tables are required, ensure foreign key columns are indexed, or pre-aggregate via a CTE/materialized view.',
    });
  }

  if (/\bSELECT\s+DISTINCT\b/i.test(normalized)) {
    const hasGroupBy = /\bGROUP\s+BY\b/i.test(normalized);
    const hasJoin = joinMatches.length > 0;
    const selectsPrimaryId = /\bSELECT\s+DISTINCT\s+(?:\w+\.)?id\b/i.test(normalized);

    if (hasGroupBy || !hasJoin || selectsPrimaryId) {
      warnings.push({
        code: 'UNNECESSARY_DISTINCT',
        severity: 'LOW',
        title: 'Potentially Unnecessary DISTINCT',
        description: hasGroupBy
          ? 'DISTINCT is redundant when paired with GROUP BY, which already produces unique groups.'
          : selectsPrimaryId
            ? 'Selecting DISTINCT on a primary key (id) forces an extra Sort/Unique step on already unique rows.'
            : 'Single-table query uses DISTINCT without JOINs; if rows are already unique, DISTINCT adds avoidable sort/hash overhead.',
        recommendation:
          'Remove DISTINCT if uniqueness is guaranteed by primary/unique keys or GROUP BY, or fix join predicates instead of masking duplicates.',
      });
    }
  }

  return warnings;
}

function extractColumnsFromFilter(filterExpr?: string): string[] {
  if (!filterExpr) return [];
  const reserved = new Set([
    'AND',
    'OR',
    'NOT',
    'NULL',
    'TRUE',
    'FALSE',
    'IS',
    'IN',
    'LIKE',
    'ILIKE',
    'SIMILAR',
    'TO',
    'ANY',
    'ALL',
    'TEXT',
    'VARCHAR',
    'INTEGER',
    'INT4',
    'INT8',
    'NUMERIC',
    'BOOLEAN',
    'TIMESTAMPTZ',
    'TIMESTAMP',
    'DATE',
  ]);

  const strippedStrings = filterExpr.replace(/'(?:''|[^'])*'/g, '');
  const matches = strippedStrings.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) ?? [];

  const uniqueCols = new Set<string>();
  for (const token of matches) {
    if (!reserved.has(token.toUpperCase())) {
      uniqueCols.add(token);
    }
  }
  return Array.from(uniqueCols);
}

export function analyzeExplainTree(
  rootPlan: PostgresExplainNode,
  tableRowCounts: Record<string, number>,
  largeTableThreshold = 1000
): {
  simplifiedSteps: SimplifiedPlanNode[];
  indexSuggestions: IndexSuggestion[];
} {
  const simplifiedSteps: SimplifiedPlanNode[] = [];
  const indexSuggestions: IndexSuggestion[] = [];
  const suggestedTables = new Set<string>();
  let stepCounter = 1;

  function describeNode(node: PostgresExplainNode, depth: number) {
    const nodeType = node['Node Type'];
    const relation = node['Relation Name'];
    const totalCost = Number(node['Total Cost'] ?? 0);
    const startupCost = Number(node['Startup Cost'] ?? 0);
    const planRows = Number(node['Plan Rows'] ?? 0);
    const actualCatalogRows = relation ? (tableRowCounts[relation] ?? planRows) : planRows;

    let plainEnglish = '';
    let isBottleneck = false;

    switch (nodeType) {
      case 'Seq Scan': {
        const filterText = node['Filter'] ? ` while filtering by ${node['Filter']}` : '';
        plainEnglish = `Full table scan on "${relation}"${filterText} (~${actualCatalogRows.toLocaleString()} rows estimated).`;

        if (actualCatalogRows >= largeTableThreshold) {
          isBottleneck = true;
          if (relation && !suggestedTables.has(relation)) {
            suggestedTables.add(relation);
            const candidateCols = extractColumnsFromFilter(node['Filter']);
            const colList = candidateCols.length > 0 ? candidateCols : ['<filter_column>'];
            const idxName = `idx_${relation}_${colList.join('_').replace(/[^a-zA-Z0-9_]/g, '')}`;

            indexSuggestions.push({
              tableName: relation,
              estimatedRows: actualCatalogRows,
              filterCondition: node['Filter'] ?? 'Full table scan (no WHERE filter)',
              suggestedColumns: candidateCols,
              suggestedSql: `CREATE INDEX CONCURRENTLY ${idxName} ON ${relation} (${colList.join(', ')});`,
              reason:
                candidateCols.length > 0
                  ? `Sequential scan detected on large table "${relation}" (~${actualCatalogRows.toLocaleString()} rows) filtering on (${candidateCols.join(', ')}).`
                  : `Sequential scan detected on large table "${relation}" (~${actualCatalogRows.toLocaleString()} rows) with no selective index predicate.`,
            });
          }
        }
        break;
      }
      case 'Index Scan':
        plainEnglish = `Index lookup on "${relation}" using index "${node['Index Name']}"${
          node['Index Cond'] ? ` matching ${node['Index Cond']}` : ''
        }.`;
        break;
      case 'Index Only Scan':
        plainEnglish = `Fast index-only lookup on "${relation}" via "${node['Index Name']}" without reading heap table pages.`;
        break;
      case 'Bitmap Heap Scan':
        plainEnglish = `Reads matching data pages from "${relation}" using a bitmap built from child index scans.`;
        break;
      case 'Bitmap Index Scan':
        plainEnglish = `Builds a memory bitmap of matching row locations from index "${node['Index Name']}".`;
        break;
      case 'Hash Join':
        plainEnglish = `Joins two datasets (${node['Join Type'] ?? 'Inner'} Join) by building an in-memory hash table${
          node['Hash Cond'] ? ` on ${node['Hash Cond']}` : ''
        }.`;
        break;
      case 'Nested Loop':
        plainEnglish = `Joins datasets (${node['Join Type'] ?? 'Inner'} Join) by iterating outer rows and probing inner rows for each match.`;
        if (planRows > 10000) isBottleneck = true;
        break;
      case 'Merge Join':
        plainEnglish = `Joins two pre-sorted datasets (${node['Join Type'] ?? 'Inner'} Join)${
          node['Merge Cond'] ? ` on ${node['Merge Cond']}` : ''
        }.`;
        break;
      case 'Sort':
        plainEnglish = `Sorts ${planRows.toLocaleString()} row(s)${
          node['Sort Key'] ? ` by ${node['Sort Key'].join(', ')}` : ''
        }.`;
        if (planRows > 10000) isBottleneck = true;
        break;
      case 'Aggregate':
      case 'HashAggregate':
      case 'GroupAggregate':
        plainEnglish = `Groups and aggregates rows (${nodeType}) to compute summary values.`;
        break;
      case 'Unique':
        plainEnglish = `Deduplicates sorted rows to satisfy DISTINCT or UNION.`;
        break;
      case 'Limit':
        plainEnglish = `Stops execution once ${planRows.toLocaleString()} row(s) have been produced.`;
        break;
      default:
        plainEnglish = `Executes "${nodeType}" operation${
          relation ? ` on "${relation}"` : ''
        } (est. ${planRows.toLocaleString()} rows).`;
    }

    simplifiedSteps.push({
      step: stepCounter++,
      depth,
      nodeType,
      relationName: relation,
      alias: node['Alias'],
      startupCost,
      totalCost,
      estimatedRows: planRows,
      plainEnglish,
      isBottleneck,
    });

    if (Array.isArray(node['Plans'])) {
      for (const child of node['Plans']) {
        describeNode(child, depth + 1);
      }
    }
  }

  describeNode(rootPlan, 0);

  return {
    simplifiedSteps,
    indexSuggestions,
  };
}
