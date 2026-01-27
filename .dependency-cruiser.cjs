/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make code hard to follow and refactor.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Modules that are not imported by anything may be dead code.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(cjs|mjs|js|ts)$", // dot files
          "\\.test\\.ts$", // test files
          "^bin/", // CLI entry points
          "^lib/", // CDK constructs
          "^scripts/", // utility scripts
        ],
      },
      to: {},
    },
    {
      name: "no-dev-deps-in-src",
      severity: "error",
      comment: "Production code should not import devDependencies.",
      from: { path: "^src/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm-dev"], pathNot: "^node_modules/@types/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "./tsconfig.json" },
    exclude: {
      path: ["dist", "cdk.out", "coverage"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
