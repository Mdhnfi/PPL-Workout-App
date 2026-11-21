import { describe, expect, it } from 'vitest';
import {
  analyzeExplainTree,
  detectSqlAntiPatterns,
  PostgresExplainNode,
  validateReadOnlySelectQuery,
} from '@/lib/queryAnalyzer';

describe('queryAnalyzer', () => {
  it('blocks non-SELECT statements', () => {
    expect(() => validateReadOnlySelectQuery('DROP TABLE users;')).toThrow();
  });

  it('detects SQL anti-patterns', () => {
    const warnings = detectSqlAntiPatterns('SELECT DISTINCT * FROM orders');
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain('SELECT_STAR');
    expect(codes).toContain('MISSING_WHERE');
    expect(codes).toContain('UNNECESSARY_DISTINCT');
  });

  it('recommends an index on large-table Seq Scan', () => {
    const mockPlan: PostgresExplainNode = {
      'Node Type': 'Seq Scan',
      'Relation Name': 'orders',
      'Startup Cost': 0,
      'Total Cost': 500,
      'Plan Rows': 200,
      Filter: "((status)::text = 'PENDING'::text)",
    };

    const { indexSuggestions } = analyzeExplainTree(mockPlan, { orders: 50000 }, 1000);
    expect(indexSuggestions).toHaveLength(1);
    expect(indexSuggestions[0].suggestedColumns).toEqual(['status']);
  });
});
