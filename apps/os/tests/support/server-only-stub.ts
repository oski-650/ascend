// Empty stand-in for the `server-only` marker module under Vitest.
//
// `server-only` is not a standalone dependency here — Next aliases it during the build. Modules
// that declare `import "server-only"` (core/command-runtime and its finance capability imports)
// would otherwise fail module resolution in the test runner.
//
// This file is test infrastructure. It adds no production capability and creates no injection
// seam in frozen code; it only satisfies a specifier that Next resolves by other means.
export {};
