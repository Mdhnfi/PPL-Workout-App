import { Sequelize } from 'sequelize';
import pg from 'pg';

const globalForSequelize = globalThis as unknown as {
  sequelizePoolCache?: Map<string, Sequelize>;
};

const poolCache =
  globalForSequelize.sequelizePoolCache ?? new Map<string, Sequelize>();

if (process.env.NODE_ENV !== 'production') {
  globalForSequelize.sequelizePoolCache = poolCache;
}

export function validatePostgresUri(connectionUri: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(connectionUri);
  } catch {
    throw new Error('Invalid database connection string format.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Only PostgreSQL connection strings (postgresql://) are supported.');
  }

  return parsed;
}

/**
 * Returns a cached, read-only Sequelize instance for a target database URI.
 * Enforces `default_transaction_read_only = on` at the PostgreSQL session level
 * to guarantee no accidental DDL/DML mutations on live databases.
 */
export async function getReadOnlySequelize(connectionUri: string): Promise<Sequelize> {
  validatePostgresUri(connectionUri);

  const existing = poolCache.get(connectionUri);
  if (existing) {
    return existing;
  }

  const sequelize = new Sequelize(connectionUri, {
    dialect: 'postgres',
    dialectModule: pg,
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 10000,
      idle: 10000,
    },
    dialectOptions: {
      options: '-c default_transaction_read_only=on',
    },
  });

  await sequelize.authenticate();
  poolCache.set(connectionUri, sequelize);
  return sequelize;
}

export function assertValidSchemaIdentifier(schemaName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema identifier: "${schemaName}"`);
  }
  return schemaName;
}
