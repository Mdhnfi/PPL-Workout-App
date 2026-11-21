# Database Schema Comparison & Version Control System (SchemaVCS)

Full-stack **Next.js + Tailwind CSS + PostgreSQL + Docker Desktop + Sequelize + Microsoft Entra ID (NextAuth) + GitHub Octokit** implementation.

## Quick Start on `localhost`

### 1. Prerequisites
- **Node.js** 18+ and **npm**
- **Docker Desktop** running locally

### 2. Start PostgreSQL Containers (`dev`, `staging`, `prod`)
```bash
docker compose up -d
```
This spins up three isolated PostgreSQL 17 databases with `pg_stat_statements` enabled and pre-seeded schema differences:
- **Development (`5433`)**: `postgresql://dba_admin:dev_password_123@localhost:5433/app_db` (`public` at `v1.3.0`)
- **Staging (`5434`)**: `postgresql://dba_admin:staging_password_123@localhost:5434/app_db` (`public` at `v1.1.0`)
- **Production (`5435`)**: `postgresql://dba_admin:prod_password_123@localhost:5435/app_db` (`public` at `v1.0.0` + unversioned `auth` schema)

### 3. Install Dependencies & Run Next.js
```bash
npm install
npm run dev
```
Open **http://localhost:3000** in your browser.

### 4. Run Automated Unit Tests
```bash
npm test
```

### 5. Optional: Connect Real Microsoft Entra ID & GitHub Repository
Edit `.env.local` and replace:
- `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` with your Entra ID App Registration values.
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` with your GitHub repository details (until configured, approved migration files are saved locally under `./migrations/`).
