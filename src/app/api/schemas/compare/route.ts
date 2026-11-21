import { NextRequest, NextResponse } from 'next/server';
import { compareInspectedSchemas } from '@/lib/schemaDiffEngine';
import { generateMigrationBundle, SqlGenerationOptions } from '@/lib/sqlGenerator';
import { InspectedSchema } from '@/types/schema';

interface CompareRequestBody {
  schemaA: InspectedSchema;
  schemaB: InspectedSchema;
  options?: SqlGenerationOptions;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CompareRequestBody;

    if (!body?.schemaA || !body?.schemaB) {
      return NextResponse.json(
        { error: 'Both schemaA and schemaB inspected payloads are required.' },
        { status: 400 }
      );
    }

    const diffReport = compareInspectedSchemas(body.schemaA, body.schemaB);
    const migrationBundle = generateMigrationBundle(diffReport, body.options);

    return NextResponse.json({
      diffReport,
      migrationBundle,
      executionPolicy: 'NO_AUTO_EXECUTION_ENFORCED',
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to compare schemas.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
