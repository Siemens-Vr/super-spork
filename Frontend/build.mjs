import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";

const options = {
  absWorkingDir: fileURLToPath(new URL("./", import.meta.url)),
  entryPoints: ["app/applicant/app.js"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: process.env.NODE_ENV !== "production",
  minify: process.env.NODE_ENV === "production",
};

export async function buildApplicant() {
  await build(options);
}
export async function watchApplicant() {
  const builder = await context(options);
  await builder.rebuild();
  await builder.watch();
  return builder;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildApplicant();
  console.log("Applicant TSX pages and CSS modules built in dist/.");
}
