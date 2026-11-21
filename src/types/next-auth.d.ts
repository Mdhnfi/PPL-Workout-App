import 'next-auth';
import 'next-auth/jwt';

export type AppRole = 'ADMIN' | 'DEVELOPER' | 'VIEWER';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: AppRole;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: AppRole;
  }
}
