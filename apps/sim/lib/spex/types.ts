/**
 * Lightweight Spex type definitions with no runtime dependencies.
 *
 * Intentionally import-free so that executor/tool type files can reference
 * SpexExecutionContext without pulling @sim/db into their module graph
 * (which would break CI scripts that run without DATABASE_URL).
 */

export type SpexExecutionContext = {
  spexUserId: string
  installId?: string | null
  runtimeSource?: string | null
}
