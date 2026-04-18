/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        utm: {
          navy:  '#002A5C',
          blue:  '#007FA3',
          light: '#E8F4F8',
        },
      },
      fontFamily: {
        sans: [
          'Inter', 'ui-sans-serif', 'system-ui', '-apple-system',
          'BlinkMacSystemFont', 'Segoe UI', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
