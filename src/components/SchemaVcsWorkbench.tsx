'use client';

import React, { useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileCode2,
  GitBranch,
  GitCompare,
  History,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import type {
  GeneratedMigrationBundle,
  InspectedSchema,
  SchemaDiffReport,
} from '@/types/schema';

interface RegisteredConnection {
  id: string;
  name: string;
  environment: 'development' | 'staging' | 'production' | 'custom';
  connectionUri: string;
  selectedSchema: string;
  availableSchemas: string[];
  status: 'untested' | 'connected' | 'error';
  errorMsg?: string;
  lastInspected?: InspectedSchema;
}

const DEFAULT_CONNECTIONS: RegisteredConnection[] = [
  {
    id: 'conn-dev',
    name: 'Dev PostgreSQL (Docker :5433)',
    environment: 'development',
    connectionUri: 'postgresql://dba_admin:dev_password_123@localhost:5433/app_db',
    selectedSchema: 'public',
    availableSchemas: ['public'],
    status: 'untested',
  },
  {
    id: 'conn-staging',
    name: 'Staging PostgreSQL (Docker :5434)',
    environment: 'staging',
    connectionUri: 'postgresql://dba_admin:staging_password_123@localhost:5434/app_db',
    selectedSchema: 'public',
    availableSchemas: ['public'],
    status: 'untested',
  },
  {
    id: 'conn-prod',
    name: 'Production PostgreSQL (Docker :5435)',
    environment: 'production',
    connectionUri: 'postgresql://dba_admin:prod_password_123@localhost:5435/app_db',
    selectedSchema: 'public',
    availableSchemas: ['public', 'auth'],
    status: 'untested',
  },
];

type ActiveTab =
  | 'connections'
  | 'compare'
  | 'migrations'
  | 'analyzer'
  | 'monitoring';

export default function SchemaVcsWorkbench() {
  const { data: session, status: authStatus } = useSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>('connections');

  // Demo sign-in form state
  const [demoEmail, setDemoEmail] = useState('dba.admin@students.swinburne.edu.my');
  const [demoName, setDemoName] = useState('Swinburne DBA Student');
  const [demoRole, setDemoRole] = useState<'ADMIN' | 'DEVELOPER' | 'VIEWER'>('ADMIN');

  // Registered connections
  const [connections, setConnections] = useState<RegisteredConnection[]>(DEFAULT_CONNECTIONS);
  const [newConnName, setNewConnName] = useState('');
  const [newConnEnv, setNewConnEnv] = useState<RegisteredConnection['environment']>('custom');
  const [newConnUri, setNewConnUri] = useState('');
  const [loadingConnId, setLoadingConnId] = useState<string | null>(null);

  // Comparison state
  const [sourceConnId, setSourceConnId] = useState<string>('conn-dev');
  const [sourceSchemaName, setSourceSchemaName] = useState<string>('public');
  const [targetConnId, setTargetConnId] = useState<string>('conn-prod');
  const [targetSchemaName, setTargetSchemaName] = useState<string>('public');
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [diffReport, setDiffReport] = useState<SchemaDiffReport | null>(null);
  const [migrationBundle, setMigrationBundle] = useState<GeneratedMigrationBundle | null>(null);

  // Migration editor & GitHub push state
  const [editableUpSql, setEditableUpSql] = useState('');
  const [editableDownSql, setEditableDownSql] = useState('');
  const [editableChangeLog, setEditableChangeLog] = useState('');
  const [authorNotes, setAuthorNotes] = useState('');
  const [humanApproved, setHumanApproved] = useState(false);
  const [pushingGit, setPushingGit] = useState(false);
  const [gitResult, setGitResult] = useState<any>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  // Query Analyzer state
  const [analyzerConnId, setAnalyzerConnId] = useState<string>('conn-prod');
  const [analyzerSchema, setAnalyzerSchema] = useState<string>('public');
  const [sqlQueryInput, setSqlQueryInput] = useState<string>(
    'SELECT DISTINCT * FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC;'
  );
  const [analyzingQuery, setAnalyzingQuery] = useState(false);
  const [analyzerError, setAnalyzerError] = useState<string | null>(null);
  const [analyzerResult, setAnalyzerResult] = useState<any>(null);

  // Health & Performance Monitoring state
  const [monitorConnId, setMonitorConnId] = useState<string>('conn-dev');
  const [monitorSchema, setMonitorSchema] = useState<string>('public');
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<any>(null);

  const userRole = session?.user?.role ?? 'VIEWER';
  const canApproveMigrations = Boolean(session?.user) && userRole !== 'VIEWER';

  async function inspectConnection(connId: string, overrideSchema?: string) {
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;

    setLoadingConnId(connId);
    const schemaToInspect = overrideSchema || conn.selectedSchema || 'public';

    try {
      const res = await fetch('/api/schemas/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionUri: conn.connectionUri,
          schemaName: schemaToInspect,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Inspection failed');
      }

      setConnections((prev) =>
        prev.map((c) =>
          c.id === connId
            ? {
                ...c,
                status: 'connected',
                errorMsg: undefined,
                selectedSchema: data.schema,
                availableSchemas: data.availableSchemas,
                lastInspected: data,
              }
            : c
        )
      );
    } catch (err: any) {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === connId
            ? {
                ...c,
                status: 'error',
                errorMsg: err.message || 'Unable to connect to PostgreSQL',
              }
            : c
        )
      );
    } finally {
      setLoadingConnId(null);
    }
  }

  function handleAddConnection(e: React.FormEvent) {
    e.preventDefault();
    if (!newConnName.trim() || !newConnUri.trim()) return;
    const newConn: RegisteredConnection = {
      id: `conn-${Date.now()}`,
      name: newConnName.trim(),
      environment: newConnEnv,
      connectionUri: newConnUri.trim(),
      selectedSchema: 'public',
      availableSchemas: ['public'],
      status: 'untested',
    };
    setConnections((prev) => [...prev, newConn]);
    setNewConnName('');
    setNewConnUri('');
  }

  async function runSchemaComparison() {
    const srcConn = connections.find((c) => c.id === sourceConnId);
    const tgtConn = connections.find((c) => c.id === targetConnId);
    if (!srcConn || !tgtConn) return;

    setComparing(true);
    setCompareError(null);
    setGitResult(null);
    setHumanApproved(false);

    try {
      const [resA, resB] = await Promise.all([
        fetch('/api/schemas/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionUri: srcConn.connectionUri,
            schemaName: sourceSchemaName,
          }),
        }),
        fetch('/api/schemas/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionUri: tgtConn.connectionUri,
            schemaName: targetSchemaName,
          }),
        }),
      ]);

      const schemaA = await resA.json();
      if (!resA.ok) throw new Error(`Source (${srcConn.name}): ${schemaA.error}`);

      const schemaB = await resB.json();
      if (!resB.ok) throw new Error(`Target (${tgtConn.name}): ${schemaB.error}`);

      const compareRes = await fetch('/api/schemas/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaA,
          schemaB,
          options: { customNotes: authorNotes },
        }),
      });
      const compareData = await compareRes.json();
      if (!compareRes.ok) throw new Error(compareData.error);

      setDiffReport(compareData.diffReport);
      setMigrationBundle(compareData.migrationBundle);
      setEditableUpSql(compareData.migrationBundle.upSql);
      setEditableDownSql(compareData.migrationBundle.downSql);
      setEditableChangeLog(compareData.migrationBundle.autoChangeLog);
    } catch (err: any) {
      setCompareError(err.message || 'Schema comparison failed.');
    } finally {
      setComparing(false);
    }
  }

  async function handleApproveAndCommit() {
    if (!migrationBundle || !diffReport) return;
    const srcConn = connections.find((c) => c.id === sourceConnId);
    const tgtConn = connections.find((c) => c.id === targetConnId);

    setPushingGit(true);
    setGitError(null);

    try {
      const res = await fetch('/api/migrations/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved: humanApproved,
          version: migrationBundle.version,
          bumpType: migrationBundle.bumpType,
          sourceEnvironment: srcConn?.environment || 'dev',
          targetEnvironment: tgtConn?.environment || 'prod',
          targetSchema: diffReport.targetSchemaName,
          upSql: editableUpSql,
          downSql: editableDownSql,
          changeLog: editableChangeLog,
          authorNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGitResult(data);
    } catch (err: any) {
      setGitError(err.message || 'Failed to commit approved migration.');
    } finally {
      setPushingGit(false);
    }
  }

  async function runQueryAnalysis() {
    const conn = connections.find((c) => c.id === analyzerConnId);
    if (!conn) return;

    setAnalyzingQuery(true);
    setAnalyzerError(null);

    try {
      const res = await fetch('/api/queries/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionUri: conn.connectionUri,
          schemaName: analyzerSchema,
          query: sqlQueryInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalyzerResult(data);
    } catch (err: any) {
      setAnalyzerError(err.message || 'Query analysis failed.');
      setAnalyzerResult(null);
    } finally {
      setAnalyzingQuery(false);
    }
  }

  async function fetchHealthMetrics() {
    const conn = connections.find((c) => c.id === monitorConnId);
    if (!conn) return;

    setMonitoringLoading(true);
    setMonitorError(null);

    try {
      const res = await fetch('/api/monitoring/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionUri: conn.connectionUri,
          schemaName: monitorSchema,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHealthData(data);
    } catch (err: any) {
      setMonitorError(err.message || 'Failed to fetch health metrics.');
    } finally {
      setMonitoringLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation & Safe Mode Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-400">
              <GitCompare className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">
                SchemaVCS — Database Schema Comparison & Version Control
              </h1>
              <p className="text-xs text-slate-400">
                PostgreSQL • Sequelize Inspector • Microsoft Entra ID RBAC • GitHub Migrations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Permanent Safety Indicator */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Safe Mode: No Auto Execution on Live DBs</span>
            </div>

            {/* Auth Session Control */}
            {authStatus === 'authenticated' && session?.user ? (
              <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
                <div className="text-right">
                  <div className="text-xs font-medium text-white">{session.user.name}</div>
                  <div className="text-[11px] text-slate-400">{session.user.email}</div>
                </div>
                <span
                  className={`px-2 py-0.5 text-[11px] font-bold rounded ${
                    userRole === 'ADMIN'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      : userRole === 'DEVELOPER'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {userRole}
                </span>
                <button
                  onClick={() => signOut()}
                  className="ml-1 text-xs text-rose-400 hover:text-rose-300 underline"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn('azure-ad')}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
              >
                Sign in with Microsoft
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {[
            { id: 'connections', label: '1. DB Connections', icon: Database },
            { id: 'compare', label: '2. Schema Comparison', icon: GitCompare },
            { id: 'migrations', label: '3. SQL & GitHub Sync', icon: FileCode2 },
            { id: 'analyzer', label: '4. Query EXPLAIN Analyzer', icon: Search },
            { id: 'monitoring', label: '5. Health & Monitoring', icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                  active
                    ? 'border-indigo-500 text-indigo-400 bg-slate-800/40'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 space-y-6">
        {/* RBAC Sign-In Banner when unauthenticated */}
        {authStatus !== 'authenticated' && (
          <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-indigo-400" />
                Role-Based Access Control (Microsoft Entra ID / Local Academic Demo)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Sign in with Microsoft Entra ID (if configured in <code>.env.local</code>) or use
                the local RBAC simulator below to test <strong>ADMIN</strong>,{' '}
                <strong>DEVELOPER</strong>, and <strong>VIEWER</strong> permissions.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                value={demoEmail}
                onChange={(e) => setDemoEmail(e.target.value)}
                placeholder="Email"
                className="px-2.5 py-1.5 text-xs rounded bg-slate-950 border border-slate-700 text-white"
              />
              <input
                type="text"
                value={demoName}
                onChange={(e) => setDemoName(e.target.value)}
                placeholder="Name"
                className="px-2.5 py-1.5 text-xs rounded bg-slate-950 border border-slate-700 text-white w-36"
              />
              <select
                value={demoRole}
                onChange={(e) => setDemoRole(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs rounded bg-slate-950 border border-slate-700 text-white"
              >
                <option value="ADMIN">ADMIN (DBA)</option>
                <option value="DEVELOPER">DEVELOPER</option>
                <option value="VIEWER">VIEWER (Read-Only)</option>
              </select>
              <button
                onClick={() =>
                  signIn('local-academic-demo', {
                    email: demoEmail,
                    name: demoName,
                    role: demoRole,
                    redirect: false,
                  })
                }
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
              >
                Demo Sign In
              </button>
              <button
                onClick={() => signIn('azure-ad')}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
              >
                Microsoft Entra ID
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 1: DATABASE CONNECTIONS & SCHEMA REGISTRY                         */}
        {/* ===================================================================== */}
        {activeTab === 'connections' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-slate-800 text-indigo-300">
                        {conn.environment}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          conn.status === 'connected'
                            ? 'text-emerald-400'
                            : conn.status === 'error'
                              ? 'text-rose-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {conn.status === 'connected'
                          ? '● Connected'
                          : conn.status === 'error'
                            ? '● Error'
                            : '○ Ready to Inspect'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white">{conn.name}</h3>
                    <p className="text-xs font-mono text-slate-400 break-all bg-slate-950 p-2 rounded border border-slate-800">
                      {conn.connectionUri.replace(/:[^:@]+@/, ':****@')}
                    </p>

                    {conn.errorMsg && (
                      <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-500/30 p-2 rounded">
                        {conn.errorMsg}
                      </p>
                    )}

                    {conn.lastInspected && (
                      <div className="text-xs bg-slate-950 p-2.5 rounded border border-slate-800 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Schema:</span>
                          <span className="font-mono text-white">{conn.lastInspected.schema}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Version Table:</span>
                          <span className="text-emerald-400 font-semibold">
                            {conn.lastInspected.versionInfo.hasVersionTable
                              ? `v${conn.lastInspected.versionInfo.latestVersion}`
                              : 'None (Structural Fallback)'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Tables Found:</span>
                          <span className="text-white">
                            {Object.keys(conn.lastInspected.tables).length}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                    <select
                      value={conn.selectedSchema}
                      onChange={(e) => {
                        const s = e.target.value;
                        setConnections((prev) =>
                          prev.map((c) => (c.id === conn.id ? { ...c, selectedSchema: s } : c))
                        );
                        inspectConnection(conn.id, s);
                      }}
                      className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-slate-700 text-white"
                    >
                      {conn.availableSchemas.map((s) => (
                        <option key={s} value={s}>
                          schema: {s}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => inspectConnection(conn.id)}
                      disabled={loadingConnId === conn.id}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          loadingConnId === conn.id ? 'animate-spin' : ''
                        }`}
                      />
                      {loadingConnId === conn.id ? 'Inspecting...' : 'Inspect Schema'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Database Connection Form */}
            <form
              onSubmit={handleAddConnection}
              className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4"
            >
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Register New PostgreSQL Connection
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  value={newConnName}
                  onChange={(e) => setNewConnName(e.target.value)}
                  placeholder="Connection Label (e.g. QA PostgreSQL)"
                  className="px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
                <select
                  value={newConnEnv}
                  onChange={(e) => setNewConnEnv(e.target.value as any)}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                >
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="custom">Custom</option>
                </select>
                <input
                  type="text"
                  required
                  value={newConnUri}
                  onChange={(e) => setNewConnUri(e.target.value)}
                  placeholder="postgresql://user:pass@localhost:5432/dbname"
                  className="md:col-span-2 px-3 py-2 text-xs font-mono rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white"
              >
                Add Database Connection
              </button>
            </form>
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 2: SCHEMA COMPARISON ENGINE                                       */}
        {/* ===================================================================== */}
        {activeTab === 'compare' && (
          <div className="space-y-6">
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <h2 className="text-sm font-bold text-white">
                Select Source (A) and Target (B) Schemas Across Environments
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Source Database (A)</label>
                  <select
                    value={sourceConnId}
                    onChange={(e) => setSourceConnId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Source Schema (A)</label>
                  <input
                    type="text"
                    value={sourceSchemaName}
                    onChange={(e) => setSourceSchemaName(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Target Database (B)</label>
                  <select
                    value={targetConnId}
                    onChange={(e) => setTargetConnId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Target Schema (B)</label>
                  <input
                    type="text"
                    value={targetSchemaName}
                    onChange={(e) => setTargetSchemaName(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>

                <button
                  onClick={runSchemaComparison}
                  disabled={comparing}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white"
                >
                  <GitCompare className="w-4 h-4" />
                  {comparing ? 'Comparing...' : 'Compare Schemas'}
                </button>
              </div>

              {compareError && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300">
                  {compareError}
                </div>
              )}
            </div>

            {diffReport && (
              <div className="space-y-6">
                {/* Version Detection & SemVer Summary Banner */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-xs text-slate-400">Detection Strategy</div>
                    <div className="text-sm font-bold text-white mt-1">
                      {diffReport.versionAnalysis.mode === 'VERSION_TRACKED'
                        ? 'Version Table Tracked (schema_versions)'
                        : 'Structural Fallback Mode (No Version Table)'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Newer Schema:{' '}
                      <span className="text-indigo-400 font-semibold">
                        {diffReport.versionAnalysis.newerSchema}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-xs text-slate-400">Detected Versions</div>
                    <div className="text-sm font-mono font-bold text-white mt-1">
                      A: {diffReport.versionAnalysis.sourceVersion ?? 'unversioned'} vs B:{' '}
                      {diffReport.versionAnalysis.targetVersion ?? 'unversioned'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Proposed Next Version:{' '}
                      <span className="text-emerald-400 font-mono font-bold">
                        v{diffReport.versionAnalysis.nextVersion}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <div className="text-xs text-slate-400">Semantic Version Bump</div>
                      <div className="text-sm font-bold text-amber-400 mt-1">
                        {diffReport.versionAnalysis.bumpType}
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab('migrations')}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                    >
                      Review Generated SQL Migration <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Bidirectional Difference Report: A vs B and B vs A */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* A vs B */}
                  <div className="p-5 rounded-xl bg-slate-900 border border-emerald-500/30 space-y-3">
                    <h3 className="text-sm font-bold text-emerald-400">
                      A vs B — Present in Source (A), Missing in Target (B)
                    </h3>
                    <ul className="space-y-2 text-xs">
                      {diffReport.aVsB.tables.map((t) => (
                        <li key={t.tableName} className="p-2 rounded bg-slate-950 border border-slate-800">
                          <span className="text-emerald-400 font-bold">[+ TABLE]</span>{' '}
                          <span className="font-mono text-white">{t.tableName}</span> (
                          {t.columns.length} columns)
                        </li>
                      ))}
                      {diffReport.aVsB.columns.map((c) => (
                        <li
                          key={`${c.table_name}.${c.column_name}`}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-emerald-400 font-bold">[+ COLUMN]</span>{' '}
                          <span className="font-mono text-white">
                            {c.table_name}.{c.column_name}
                          </span>{' '}
                          ({c.udt_name})
                        </li>
                      ))}
                      {diffReport.aVsB.indexes.map((i) => (
                        <li
                          key={i.index_name}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-emerald-400 font-bold">[+ INDEX]</span>{' '}
                          <span className="font-mono text-white">{i.index_name}</span> on{' '}
                          {i.table_name} ({i.columns.join(', ')})
                        </li>
                      ))}
                      {diffReport.aVsB.foreignKeys.map((fk) => (
                        <li
                          key={fk.constraint_name}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-emerald-400 font-bold">[+ FK]</span>{' '}
                          <span className="font-mono text-white">{fk.constraint_name}</span>
                        </li>
                      ))}
                      {diffReport.aVsB.constraints.map((con) => (
                        <li
                          key={con.constraint_name}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-emerald-400 font-bold">
                            [+ {con.constraint_type}]
                          </span>{' '}
                          <span className="font-mono text-white">{con.constraint_name}</span>
                        </li>
                      ))}
                      {diffReport.aVsB.tables.length === 0 &&
                        diffReport.aVsB.columns.length === 0 &&
                        diffReport.aVsB.indexes.length === 0 &&
                        diffReport.aVsB.foreignKeys.length === 0 &&
                        diffReport.aVsB.constraints.length === 0 && (
                          <li className="text-slate-400">No missing objects in Target (B).</li>
                        )}
                    </ul>
                  </div>

                  {/* B vs A */}
                  <div className="p-5 rounded-xl bg-slate-900 border border-amber-500/30 space-y-3">
                    <h3 className="text-sm font-bold text-amber-400">
                      B vs A — Present in Target (B), Missing in Source (A)
                    </h3>
                    <ul className="space-y-2 text-xs">
                      {diffReport.bVsA.tables.map((t) => (
                        <li key={t.tableName} className="p-2 rounded bg-slate-950 border border-slate-800">
                          <span className="text-amber-400 font-bold">[EXTRA TABLE]</span>{' '}
                          <span className="font-mono text-white">{t.tableName}</span>
                        </li>
                      ))}
                      {diffReport.bVsA.columns.map((c) => (
                        <li
                          key={`${c.table_name}.${c.column_name}`}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-amber-400 font-bold">[EXTRA COLUMN]</span>{' '}
                          <span className="font-mono text-white">
                            {c.table_name}.{c.column_name}
                          </span>
                        </li>
                      ))}
                      {diffReport.bVsA.indexes.map((i) => (
                        <li
                          key={i.index_name}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-amber-400 font-bold">[EXTRA INDEX]</span>{' '}
                          <span className="font-mono text-white">{i.index_name}</span>
                        </li>
                      ))}
                      {diffReport.modifiedColumns.map((m) => (
                        <li
                          key={`${m.tableName}.${m.columnName}`}
                          className="p-2 rounded bg-slate-950 border border-slate-800"
                        >
                          <span className="text-sky-400 font-bold">[MODIFIED COLUMN]</span>{' '}
                          <span className="font-mono text-white">
                            {m.tableName}.{m.columnName}
                          </span>{' '}
                          ({m.changes.join(', ')})
                        </li>
                      ))}
                      {diffReport.bVsA.tables.length === 0 &&
                        diffReport.bVsA.columns.length === 0 &&
                        diffReport.bVsA.indexes.length === 0 &&
                        diffReport.modifiedColumns.length === 0 && (
                          <li className="text-slate-400">No extra objects in Target (B).</li>
                        )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 3: SQL SCRIPT GENERATOR & GITHUB COMMIT                           */}
        {/* ===================================================================== */}
        {activeTab === 'migrations' && (
          <div className="space-y-6">
            {!migrationBundle ? (
              <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-3">
                <p className="text-sm text-slate-300">
                  Run a Schema Comparison first to generate versioned UP and DOWN SQL scripts.
                </p>
                <button
                  onClick={() => setActiveTab('compare')}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                >
                  Go to Schema Comparison
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Forward Migration Script (V{migrationBundle.version}__*.sql)
                      </h3>
                      <span className="text-[11px] text-slate-400">Editable before approval</span>
                    </div>
                    <textarea
                      rows={16}
                      value={editableUpSql}
                      onChange={(e) => setEditableUpSql(e.target.value)}
                      className="w-full p-3 font-mono text-xs rounded-lg bg-slate-950 border border-slate-800 text-emerald-200"
                    />
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                        Rollback Script (U{migrationBundle.version}__*.sql)
                      </h3>
                      <span className="text-[11px] text-slate-400">Editable before approval</span>
                    </div>
                    <textarea
                      rows={16}
                      value={editableDownSql}
                      onChange={(e) => setEditableDownSql(e.target.value)}
                      className="w-full p-3 font-mono text-xs rounded-lg bg-slate-950 border border-slate-800 text-amber-200"
                    />
                  </div>
                </div>

                {/* Change Log + Human Approval & GitHub Commit */}
                <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-indigo-400" />
                    Change Log, Human Review & GitHub Repository Commit
                  </h3>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Generated Change Log (Markdown)
                      </label>
                      <textarea
                        rows={6}
                        value={editableChangeLog}
                        onChange={(e) => setEditableChangeLog(e.target.value)}
                        className="w-full p-3 font-mono text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                      />
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Author Review Notes
                        </label>
                        <input
                          type="text"
                          value={authorNotes}
                          onChange={(e) => setAuthorNotes(e.target.value)}
                          placeholder="e.g. Approved after staging verification"
                          className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                        />
                      </div>

                      <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={humanApproved}
                          onChange={(e) => setHumanApproved(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span className="text-xs text-slate-300">
                          I have reviewed the UP and DOWN SQL scripts and approve saving them to
                          version control. <strong>No SQL will be auto-executed</strong> on live
                          databases.
                        </span>
                      </label>

                      <button
                        onClick={handleApproveAndCommit}
                        disabled={!humanApproved || !canApproveMigrations || pushingGit}
                        className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold text-white transition"
                      >
                        {!session?.user
                          ? 'Sign In Above to Approve Migrations'
                          : userRole === 'VIEWER'
                            ? 'VIEWER Role Cannot Approve Migrations'
                            : pushingGit
                              ? 'Committing Versioned Files...'
                              : `Approve & Push v${migrationBundle.version} to GitHub`}
                      </button>
                    </div>
                  </div>

                  {gitError && (
                    <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300">
                      {gitError}
                    </div>
                  )}

                  {gitResult && (
                    <div className="p-4 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-200 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Migration Committed Safely ({gitResult.storageMode})
                      </div>
                      <div>Commit SHA: <code>{gitResult.commitSha}</code></div>
                      <div>Files: <code>{gitResult.files.upFilePath}</code>, <code>{gitResult.files.downFilePath}</code></div>
                      {gitResult.commitUrl && (
                        <a
                          href={gitResult.commitUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-emerald-300 font-semibold"
                        >
                          View Commit on GitHub
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 4: QUERY EXECUTION ANALYZER & INDEX ADVISOR                       */}
        {/* ===================================================================== */}
        {activeTab === 'analyzer' && (
          <div className="space-y-6">
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  Read-Only SELECT Execution Plan Analyzer (EXPLAIN)
                </h2>
                <div className="flex items-center gap-2">
                  <select
                    value={analyzerConnId}
                    onChange={(e) => setAnalyzerConnId(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded bg-slate-950 border border-slate-700 text-white"
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={analyzerSchema}
                    onChange={(e) => setAnalyzerSchema(e.target.value)}
                    className="w-24 px-2.5 py-1.5 text-xs font-mono rounded bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <textarea
                rows={4}
                value={sqlQueryInput}
                onChange={(e) => setSqlQueryInput(e.target.value)}
                placeholder="Enter a read-only SELECT query..."
                className="w-full p-3 font-mono text-xs rounded-lg bg-slate-950 border border-slate-800 text-sky-200"
              />

              <button
                onClick={runQueryAnalysis}
                disabled={analyzingQuery}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white"
              >
                <Play className="w-3.5 h-3.5" />
                {analyzingQuery ? 'Analyzing Execution Plan...' : 'Run EXPLAIN & Anti-Pattern Check'}
              </button>

              {analyzerError && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{analyzerError}</span>
                </div>
              )}
            </div>

            {analyzerResult && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Simplified Execution Plan */}
                <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    Simplified Execution Plan Breakdown
                  </h3>
                  <div className="space-y-2">
                    {analyzerResult.simplifiedPlan.map((step: any) => (
                      <div
                        key={step.step}
                        style={{ marginLeft: `${step.depth * 14}px` }}
                        className={`p-3 rounded-lg border text-xs ${
                          step.isBottleneck
                            ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex justify-between font-bold">
                          <span>
                            Step {step.step}: {step.nodeType}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            Cost: {step.totalCost} | Rows: {step.estimatedRows}
                          </span>
                        </div>
                        <p className="mt-1">{step.plainEnglish}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Anti-Patterns & Index Suggestions */}
                <div className="space-y-6">
                  <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                    <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Detected SQL Anti-Patterns ({analyzerResult.antiPatterns.length})
                    </h3>
                    {analyzerResult.antiPatterns.length === 0 ? (
                      <p className="text-xs text-emerald-400">No common SQL anti-patterns detected.</p>
                    ) : (
                      <div className="space-y-2">
                        {analyzerResult.antiPatterns.map((ap: any) => (
                          <div
                            key={ap.code}
                            className="p-3 rounded-lg bg-slate-950 border border-amber-500/30 text-xs space-y-1"
                          >
                            <div className="font-bold text-amber-300">
                              [{ap.severity}] {ap.title}
                            </div>
                            <p className="text-slate-400">{ap.description}</p>
                            <p className="text-emerald-300">Fix: {ap.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                    <h3 className="text-sm font-bold text-indigo-400">
                      Index Advisor & Unused Indexes
                    </h3>
                    {analyzerResult.performanceSuggestions.recommendedIndexes.map(
                      (rec: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-950 border border-indigo-500/30 text-xs space-y-1"
                        >
                          <div className="text-slate-300">{rec.reason}</div>
                          <code className="block p-2 rounded bg-slate-900 text-emerald-300">
                            {rec.suggestedSql}
                          </code>
                        </div>
                      )
                    )}

                    <div className="pt-2 border-t border-slate-800">
                      <div className="text-xs font-semibold text-slate-300 mb-2">
                        Unused Indexes (idx_scan = 0):
                      </div>
                      {analyzerResult.performanceSuggestions.unusedIndexes.length === 0 ? (
                        <p className="text-xs text-slate-400">No unused indexes found.</p>
                      ) : (
                        analyzerResult.performanceSuggestions.unusedIndexes.map((u: any) => (
                          <div
                            key={u.index_name}
                            className="text-xs font-mono text-rose-300 bg-slate-950 p-2 rounded border border-slate-800 mb-1"
                          >
                            {u.table_name}.{u.index_name} ({u.index_size}) — 0 scans
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 5: HEALTH & PERFORMANCE MONITORING                                */}
        {/* ===================================================================== */}
        {activeTab === 'monitoring' && (
          <div className="space-y-6">
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-white">
                  PostgreSQL System Catalog & Statistical Health Monitor
                </h2>
                <p className="text-xs text-slate-400">
                  Live metrics from <code>pg_stat_database</code>, <code>pg_stat_user_tables</code>,{' '}
                  <code>pg_stat_activity</code>, and <code>pg_stat_statements</code>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={monitorConnId}
                  onChange={(e) => setMonitorConnId(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={monitorSchema}
                  onChange={(e) => setMonitorSchema(e.target.value)}
                  className="w-24 px-3 py-2 text-xs font-mono rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
                <button
                  onClick={fetchHealthMetrics}
                  disabled={monitoringLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${monitoringLoading ? 'animate-spin' : ''}`} />
                  {monitoringLoading ? 'Refreshing...' : 'Collect Metrics'}
                </button>
              </div>
            </div>

            {monitorError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300">
                {monitorError}
              </div>
            )}

            {healthData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-xs text-slate-400">Query Performance Score</div>
                    <div className="text-2xl font-extrabold text-emerald-400 mt-1">
                      {healthData.performanceScore.overallScore} / 100
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Grade: {healthData.performanceScore.grade}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-xs text-slate-400">Buffer Cache Hit Ratio</div>
                    <div className="text-2xl font-extrabold text-white mt-1">
                      {healthData.databaseHealth?.cache_hit_ratio ?? 100}%
                    </div>
                    <div className="text-[11px] text-slate-400">Target: ≥ 99%</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-xs text-slate-400">Database Size</div>
                    <div className="text-2xl font-extrabold text-white mt-1">
                      {healthData.databaseHealth?.database_size}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Active Backends: {healthData.databaseHealth?.active_connections}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-xs text-slate-400">Long-Running Queries</div>
                    <div className="text-2xl font-extrabold text-amber-400 mt-1">
                      {healthData.longRunningQueries.length}
                    </div>
                    <div className="text-[11px] text-slate-400">Threshold: ≥ 2000ms</div>
                  </div>
                </div>

                {/* Table Health Metrics */}
                <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
                  <h3 className="text-sm font-bold text-white mb-3">
                    Table Health Metrics (pg_stat_user_tables)
                  </h3>
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2">Table</th>
                        <th className="py-2">Size</th>
                        <th className="py-2">Live Tuples</th>
                        <th className="py-2">Dead Tuples</th>
                        <th className="py-2">Seq Scans</th>
                        <th className="py-2">Idx Scans</th>
                        <th className="py-2">Idx Usage %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {healthData.tableHealth.map((t: any) => (
                        <tr key={t.table_name}>
                          <td className="py-2 font-mono text-white">{t.table_name}</td>
                          <td className="py-2">{t.total_size}</td>
                          <td className="py-2">{t.live_tuples}</td>
                          <td className="py-2">{t.dead_tuples}</td>
                          <td className="py-2">{t.seq_scan}</td>
                          <td className="py-2">{t.idx_scan}</td>
                          <td className="py-2 text-emerald-400">{t.index_usage_ratio}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Historical Query Monitoring */}
                <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
                  <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <History className="w-4 h-4 text-indigo-400" />
                    Historical Query Monitoring (pg_stat_statements)
                  </h3>
                  {healthData.historicalQueries.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No historical user queries recorded yet in <code>pg_stat_statements</code>.
                    </p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2">Query</th>
                          <th className="py-2">Calls</th>
                          <th className="py-2">Mean Exec (ms)</th>
                          <th className="py-2">Rows Returned</th>
                          <th className="py-2">Capture Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {healthData.historicalQueries.map((q: any) => (
                          <tr key={q.queryId}>
                            <td className="py-2 font-mono text-slate-200 max-w-md truncate">
                              {q.query}
                            </td>
                            <td className="py-2">{q.calls}</td>
                            <td className="py-2 text-amber-300">{q.exec_time_ms} ms</td>
                            <td className="py-2">{q.rows_returned}</td>
                            <td className="py-2 text-slate-400">{q.capture_time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
