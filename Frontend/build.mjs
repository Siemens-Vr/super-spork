import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";

const options = (portal = 'applicant') => ({
  absWorkingDir: fileURLToPath(new URL("./", import.meta.url)),
  entryPoints: [`app/${portal}/app.js`],
  outdir: portal === 'applicant' ? 'dist' : `dist/${portal}`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: process.env.NODE_ENV !== "production",
  minify: process.env.NODE_ENV === "production",
});

export async function buildApplicant() {
  await build(options());
}
export async function watchApplicant() {
  const builder = await context(options());
  await builder.rebuild();
  await builder.watch();
  return builder;
}
export async function buildAdmin() { await build(options('admin')); }
export async function watchAdmin() {
  const builder = await context(options('admin'));
  await builder.rebuild();
  await builder.watch();
  return builder;
}
export async function buildTrainer() { await build(options('trainer')); }
export async function watchTrainer() {const builder=await context(options('trainer'));await builder.rebuild();await builder.watch();return builder;}
export async function buildEmployer() { await build(options('employer')); }
export async function watchEmployer() {
  const builder = await context(options('employer'));
  await builder.rebuild();
  await builder.watch();
  return builder;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildApplicant();
  await buildAdmin();
  await buildTrainer();
  await buildEmployer();
  console.log("Applicant, admin, trainer and employer assets built in dist/.");
}
