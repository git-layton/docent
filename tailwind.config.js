/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#4A5D75', 'primary-dark': '#2C3E50', secondary: '#6A829E',
        'secondary-light': '#9EADC8', accent: '#D4AA7D', success: '#7A9E8D', surface: '#F0F4F8',
      },
      fontSize: { tiny: ['10px',{lineHeight:'1.2'}], micro: ['9px',{lineHeight:'1.2'}] }
    },
  },
  plugins: [],
}