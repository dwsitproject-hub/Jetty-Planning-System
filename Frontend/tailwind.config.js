/** @type {import('tailwindcss').Config} */
export default {
  important: '.cm-root',
  content: [
    './index.html',
    './src/pages/CargoMovement*.jsx',
    './src/components/cargoMovement-v2/**/*.{js,jsx}',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        cmAtg: '#166534',
        cmGap: '#d97706',
        cmFault: '#b91c1c',
      },
    },
  },
  plugins: [],
};
