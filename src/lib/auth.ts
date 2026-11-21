import type { NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { AppRole } from '@/types/next-auth';

interface EntraProfile {
  email?: string;
  preferred_username?: string;
  roles?: string[];
}

function resolveUserRole(profile?: EntraProfile): AppRole {
  const entraRoles = profile?.roles ?? [];

  if (entraRoles.includes('DBA_ADMIN') || entraRoles.includes('Admin')) {
    return 'ADMIN';
  }
  if (entraRoles.includes('DEVELOPER') || entraRoles.includes('Developer')) {
    return 'DEVELOPER';
  }

  const email = (profile?.email ?? profile?.preferred_username ?? '').toLowerCase();
  const bootstrapAdmins = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (email && bootstrapAdmins.includes(email)) {
    return 'ADMIN';
  }

  return 'VIEWER';
}

const isEntraConfigured =
  Boolean(process.env.AZURE_AD_CLIENT_ID) &&
  process.env.AZURE_AD_CLIENT_ID !== 'your-entra-application-client-id' &&
  Boolean(process.env.AZURE_AD_CLIENT_SECRET) &&
  Boolean(process.env.AZURE_AD_TENANT_ID);

const providers: NextAuthOptions['providers'] = [];

if (isEntraConfigured) {
  providers.push(
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: {
        params: {
          scope: 'openid profile email',
        },
      },
    })
  );
}

if (process.env.DEV_LOCAL_AUTH_ENABLED !== 'false') {
  providers.push(
    CredentialsProvider({
      id: 'local-academic-demo',
      name: 'Local Academic Demo (Microsoft RBAC Simulator)',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'dba@swinburne.edu.my' },
        name: { label: 'Display Name', type: 'text', placeholder: 'Swinburne Student' },
        role: { label: 'Role', type: 'text', placeholder: 'ADMIN | DEVELOPER | VIEWER' },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        const requestedRole = (credentials.role || 'ADMIN').toUpperCase();
        const validRole: AppRole =
          requestedRole === 'DEVELOPER' || requestedRole === 'VIEWER'
            ? requestedRole
            : 'ADMIN';

        return {
          id: credentials.email,
          email: credentials.email,
          name: credentials.name || credentials.email.split('@')[0],
          role: validRole,
        };
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, profile }) {
      if (user && 'role' in user && user.role) {
        token.role = user.role as AppRole;
      } else if (profile) {
        token.role = resolveUserRole(profile as EntraProfile);
      }
      if (!token.role) {
        token.role = 'VIEWER';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role ?? 'VIEWER';
      }
      return session;
    },
  },
};
