import daisyui from "daisyui";
import containerQueries from "@tailwindcss/container-queries";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  // We strictly follow the daisyui plugin usage as requested
  plugins: [
    require('@tailwindcss/typography'),
    require("daisyui"),
    require('@tailwindcss/container-queries'),
  ],
  // Setup Daisy UI neon/cyber themes
  daisyui: {
    themes: [
      "retro",
      "synthwave"
    ],
    darkTheme: "synthwave",
  },
}
