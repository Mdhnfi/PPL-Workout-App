import fs from 'fs/promises';
import path from 'path';
import { Octokit } from '@octokit/rest';
import type { AppRole } from '@/types/next-auth';

export interface MigrationCommitPayload {
  version: string;
  bumpType: 'MAJOR' | 'MINOR' | 'PATCH' | 'NONE';
  sourceEnvironment: string;
  targetEnvironment: string;
  targetSchema: string;
  upSql: string;
  downSql: string;
  changeLog: string;
  authorNotes?: string;
  approvedBy: {
    name: string;
    email: string;
    role: AppRole;
  };
}

export interface AuditLogEntry {
  id: string;
  version: string;
  bumpType: string;
  sourceEnvironment: string;
  targetEnvironment: string;
  targetSchema: string;
  upFilePath: string;
  downFilePath: string;
  changeLogPath: string;
  approvedByEmail: string;
  approvedByRole: AppRole;
  authorNotes: string;
  executionPolicy: 'NO_AUTO_EXECUTION_COMMITTED_TO_GIT';
  committedAt: string;
}

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function saveLocallyToWorkspace(
  files: Array<{ path: string; content: string }>,
  auditEntry: AuditLogEntry
) {
  const rootDir = process.cwd();
  for (const file of files) {
    const absPath = path.join(rootDir, file.path);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.content, 'utf-8');
  }

  return {
    commitSha: `local-${Date.now().toString(16)}`,
    commitUrl: null,
    branch: 'local-workspace',
    storageMode: 'LOCAL_DISK_FALLBACK' as const,
    files: {
      upFilePath: auditEntry.upFilePath,
      downFilePath: auditEntry.downFilePath,
      changeLogPath: auditEntry.changeLogPath,
      auditLogPath: 'migrations/audit-log.json',
    },
    auditEntry,
  };
}

export async function pushApprovedMigrationToGitHub(
  payload: MigrationCommitPayload
) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  const branch = process.env.GITHUB_BRANCH?.trim() || 'main';

  const cleanVersion = payload.version.replace(/^v/i, '').replace(/[^0-9.]/g, '');
  const slug = sanitizeSegment(
    `${payload.sourceEnvironment}_to_${payload.targetEnvironment}_${payload.targetSchema}`
  );

  const upFilePath = `migrations/V${cleanVersion}__${slug}.sql`;
  const downFilePath = `migrations/U${cleanVersion}__${slug}.sql`;
  const changeLogPath = `migrations/changelogs/CHANGELOG_v${cleanVersion}.md`;
  const auditLogPath = `migrations/audit-log.json`;

  const committedAt = new Date().toISOString();
  const auditEntry: AuditLogEntry = {
    id: `MIG-${Date.now()}`,
    version: cleanVersion,
    bumpType: payload.bumpType,
    sourceEnvironment: payload.sourceEnvironment,
    targetEnvironment: payload.targetEnvironment,
    targetSchema: payload.targetSchema,
    upFilePath,
    downFilePath,
    changeLogPath,
    approvedByEmail: payload.approvedBy.email,
    approvedByRole: payload.approvedBy.role,
    authorNotes: payload.authorNotes?.trim() || 'Auto-generated schema sync',
    executionPolicy: 'NO_AUTO_EXECUTION_COMMITTED_TO_GIT',
    committedAt,
  };

  // If GitHub PAT is not configured yet, save versioned files locally in ./migrations/
  if (!token || !owner || !repo) {
    let existingLocalLogs: AuditLogEntry[] = [];
    try {
      const existingRaw = await fs.readFile(path.join(process.cwd(), auditLogPath), 'utf-8');
      const parsed = JSON.parse(existingRaw);
      if (Array.isArray(parsed)) existingLocalLogs = parsed;
    } catch {
      // Ignore if not yet created
    }

    const updatedLocalJson = JSON.stringify([auditEntry, ...existingLocalLogs], null, 2);
    return saveLocallyToWorkspace(
      [
        { path: upFilePath, content: payload.upSql },
        { path: downFilePath, content: payload.downSql },
        { path: changeLogPath, content: payload.changeLog },
        { path: auditLogPath, content: updatedLocalJson },
      ],
      auditEntry
    );
  }

  const octokit = new Octokit({ auth: token });

  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = refData.object.sha;

  const { data: latestCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: latestCommitSha,
  });
  const baseTreeSha = latestCommit.tree.sha;

  let existingAuditLogs: AuditLogEntry[] = [];
  try {
    const { data: auditFile } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: auditLogPath,
      ref: branch,
    });

    if (!Array.isArray(auditFile) && auditFile.type === 'file' && auditFile.content) {
      const decoded = Buffer.from(auditFile.content, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed)) {
        existingAuditLogs = parsed;
      }
    }
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) {
      throw err;
    }
  }

  const updatedAuditJson = JSON.stringify(
    [auditEntry, ...existingAuditLogs],
    null,
    2
  );

  const filesToCommit = [
    { path: upFilePath, content: payload.upSql },
    { path: downFilePath, content: payload.downSql },
    { path: changeLogPath, content: payload.changeLog },
    { path: auditLogPath, content: updatedAuditJson },
  ];

  const treeEntries = await Promise.all(
    filesToCommit.map(async (file) => {
      const { data: blob } = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: file.content,
        encoding: 'utf-8',
      });

      return {
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      };
    })
  );

  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const commitMessage = `chore(schema): approve migration v${cleanVersion} (${payload.bumpType}) for ${payload.targetEnvironment}.${payload.targetSchema}`;

  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: [latestCommitSha],
    author: {
      name: payload.approvedBy.name || payload.approvedBy.email,
      email: payload.approvedBy.email,
      date: committedAt,
    },
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return {
    commitSha: newCommit.sha,
    commitUrl: newCommit.html_url,
    branch,
    storageMode: 'GITHUB_REPOSITORY' as const,
    files: {
      upFilePath,
      downFilePath,
      changeLogPath,
      auditLogPath,
    },
    auditEntry,
  };
}
