import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pushApprovedMigrationToGitHub } from '@/lib/githubPublisher';

interface ApproveMigrationRequest {
  approved: boolean;
  version: string;
  bumpType: 'MAJOR' | 'MINOR' | 'PATCH' | 'NONE';
  sourceEnvironment: string;
  targetEnvironment: string;
  targetSchema: string;
  upSql: string;
  downSql: string;
  changeLog: string;
  authorNotes?: string;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in with Microsoft Entra ID or Demo RBAC.' },
        { status: 401 }
      );
    }

    const userRole = session.user.role;
    if (userRole === 'VIEWER') {
      return NextResponse.json(
        {
          error:
            'Forbidden: Users with the VIEWER role cannot approve or push schema migrations.',
        },
        { status: 403 }
      );
    }

    const body = (await req.json()) as ApproveMigrationRequest;

    if (body.approved !== true) {
      return NextResponse.json(
        {
          error:
            'Explicit human review and approval (`approved: true`) is required before saving/pushing migration scripts.',
        },
        { status: 400 }
      );
    }

    if (!body.version || !body.upSql?.trim() || !body.downSql?.trim()) {
      return NextResponse.json(
        { error: 'version, upSql, and downSql are required.' },
        { status: 400 }
      );
    }

    const result = await pushApprovedMigrationToGitHub({
      version: body.version,
      bumpType: body.bumpType || 'PATCH',
      sourceEnvironment: body.sourceEnvironment || 'dev',
      targetEnvironment: body.targetEnvironment || 'staging',
      targetSchema: body.targetSchema || 'public',
      upSql: body.upSql,
      downSql: body.downSql,
      changeLog: body.changeLog || `## Release v${body.version}`,
      authorNotes: body.authorNotes,
      approvedBy: {
        name: session.user.name || session.user.email,
        email: session.user.email,
        role: userRole,
      },
    });

    return NextResponse.json({
      status: 'COMMITTED_SAFE_NO_AUTO_EXECUTION',
      executionPolicy: 'NO_AUTO_EXECUTION_ON_LIVE_DB',
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to save and push approved migration.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
