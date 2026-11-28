// MONGODB_TEST_URI=mongodb+srv://... npm run test:mongodb
import { defineConfig } from 'vitest/config';

if (!process.env.MONGODB_TEST_URI) throw new Error('Set MONGODB_TEST_URI to a MongoDB test cluster URI.');

export default defineConfig({
  test: {
    include: ['tests/mongo.test.ts'],
    environment: 'node',
    env: { AUTH_DISABLED: '1', MONGODB_TEST_URI: process.env.MONGODB_TEST_URI },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
