/**
 * Tailwind v4 via PostCSS — required because `@tailwindcss/vite` is a Vite
 * plugin and Vite is no longer in this pipeline. Tailwind 4 ships its own
 * PostCSS plugin; no `tailwind.config.js` is needed, since the theme lives in
 * `src/tailwind.css` under `@theme inline`.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
