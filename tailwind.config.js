/** @type {import('tailwindcss').Config} */
export default {
  // Paths are resolved relative to this file, so it works on Windows, macOS and Linux.
  content: { relative: true, files: ['./client/index.html', './client/src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        // Gold, taken from the Creatign mark. 600+ is dark enough for white text and links.
        brand: {
          50: '#fbf7ee', 100: '#f5eacd', 200: '#ead39a', 300: '#ddb866', 400: '#cf9f3e',
          500: '#b8862a', 600: '#946414', 700: '#7a5212', 800: '#5f4011', 900: '#4a3210',
        },
        // Deep navy used for the sidebar, primary buttons and headings
        ink: { 950: '#0a101c', 900: '#0e1726', 800: '#152033', 700: '#1e2b42', 600: '#2c3b56', 500: '#43526e' },
        canvas: '#f4f3ef',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'] },
      fontSize: { xxs: ['11px', '14px'] },
    },
  },
  plugins: [],
};
