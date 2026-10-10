import type { Config } from 'drizzle-kit';

/**
 * `npm run db:generate` → src/db/migrations/*.sql + migrations.js (bundled via
 * babel-plugin-inline-import; metro has `sql` in sourceExts).
 * driver 'expo' is what drizzle documents for op-sqlite too: it emits the
 * `migrations.js` bundle that our migrator (src/db/migrate.ts) consumes.
 */
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
