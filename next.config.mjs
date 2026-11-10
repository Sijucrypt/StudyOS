/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/internal/library-worker": [
      "./src/features/library/parser-thread.mjs",
      "./src/features/library/parse.mjs",
      "./src/features/library/formats.mjs",
      "./node_modules/pdfjs-dist/{package.json,legacy/build/*.mjs,cmaps/**/*,standard_fonts/**/*}",
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/{yauzl,pend,saxes,xmlchars}/**/*",
    ],
  },
};

export default nextConfig;
