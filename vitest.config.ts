import { defineConfig } from 'vitest/config';
// API tests talk to the server without signing in; tests/auth.test.ts turns sign-in back on.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', env: { AUTH_DISABLED: '1' } } });
