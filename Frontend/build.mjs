import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";

const options = {
  absWorkingDir: fileURLToPath(new URL("./", import.meta.url)),
  entryPoints: {
    app: "app/applicant/app.js",
    admin: "app/admin/app.tsx",
    trainer: "app/trainer/app.tsx",
    employer: "app/employer/app.tsx",
  },
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
  console.log("All portal pages and shared CSS modules built in dist/.");
}
