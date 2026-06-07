/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#4A5D75', 'primary-dark': '#2C3E50', 'primary-hover': '#3D4D61',
        secondary: '#6A829E', 'secondary-light': '#9EADC8', 'secondary-muted': '#899AB5',
        accent: '#D4AA7D', error: '#C98A8A', 'error-dark': '#B57070',
        success: '#7A9E8D', 'success-light': '#9FBBAF', surface: '#F0F4F8',
      },
      fontSize: {
        micro: ['9px', { lineHeight: '1.2' }],
        tiny: ['10px', { lineHeight: '1.2' }],
        mini: ['11px', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
}
