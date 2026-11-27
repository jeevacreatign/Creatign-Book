// npm run test:mysql — the whole API suite on a real MySQL database (see tests/support/mysql-suite.ts).
// TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/empty_test_db npm run test:mysql
import { defineConfig } from 'vitest/config';

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to an empty MySQL database (every table in it is dropped)');

export default defineConfig({
  // the test files pin themselves to the in-memory store; drop that line so they use MySQL
  plugins: [{ name: 'tests-on-mysql', enforce: 'pre', transform: (code, id) => (/\/tests\/[^/]+\.test\.ts$/.test(id) ? code.replace(/process\.env\.DB_FILE = ':memory:';?/g, '') : undefined) }],
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/mysql.test.ts'],
    environment: 'node',
    env: { AUTH_DISABLED: '1', DATABASE_URL: process.env.TEST_DATABASE_URL },
    setupFiles: ['./tests/support/mysql-suite.ts'],
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
