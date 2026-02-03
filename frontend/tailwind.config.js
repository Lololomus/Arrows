/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Arrow Puzzle Brand Colors
        'ap': {
          'red': '#FF3B30',
          'orange': '#FF9500',
          'yellow': '#FFCC00',
          'green': '#34C759',
          'blue': '#007AFF',
          'purple': '#AF52DE',
          'pink': '#FF2D55',
          'indigo': '#5856D6',
          'teal': '#00C7BE',
          'silver': '#C7C7CC',
          'gold': '#FFD700',
        },
        // Background colors
        'bg': {
          'primary': '#FFFFFF',
          'secondary': '#F2F2F7',
          'tertiary': '#E5E5EA',
        },
        // Text colors
        'text': {
          'primary': '#1A1A1A',
          'secondary': '#8E8E93',
          'tertiary': '#C7C7CC',
        },
      },
      fontFamily: {
        'sans': ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      animation: {
        'shake': 'shake 0.3s cubic-bezier(.36,.07,.19,.97) both',
        'pulse-hint': 'pulse-hint 1s ease-in-out infinite',
        'fly-out': 'fly-out 0.3s ease-out forwards',
        'fade-in': 'fade-in 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
        'pulse-hint': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        'fly-out': {
          '0%': { opacity: '1', transform: 'translate(0, 0)' },
          '100%': { opacity: '0', transform: 'translate(var(--fly-x), var(--fly-y))' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};