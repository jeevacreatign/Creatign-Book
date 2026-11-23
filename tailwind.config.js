/** @type {import('tailwindcss').Config} */
export default {
  // Paths are resolved relative to this file, so it works on Windows, macOS and Linux.
  content: { relative: true, files: ['./client/index.html', './client/src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dbe6ff', 200: '#bfd3ff', 300: '#93b5fd', 400: '#6090fa',
          500: '#3b6ef5', 600: '#2554e0', 700: '#1d43b8', 800: '#1e3a8f', 900: '#1e3471',
        },
        ink: { 900: '#0f1b2d', 800: '#16253b', 700: '#1f314c' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'] },
      fontSize: { xxs: ['11px', '14px'] },
    },
  },
  plugins: [],
};
