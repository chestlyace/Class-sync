import type { z } from 'zod'
import type { Ctx } from '@/server/core/context'

export type McpScope = 'clasync:read' | 'clasync:write'

/**
 * One MCP tool: a thin wrapper over existing services. `run` gets the lecturer's `Ctx` (the same
 * permissions as in the app) and the parsed input, and returns plain JSON for the assistant; it
 * throws `AppError` like any service. Draft tools (`clasync:write`) never publish, release, start
 * or confirm anything — the lecturer approves in the app.
 */
export type McpTool<Input extends z.ZodObject = z.ZodObject> = {
  name: string
  title: string
  description: string
  scope: McpScope
  input: Input
  run: (ctx: Ctx, input: z.infer<Input>) => Promise<unknown>
}

/** Keeps `run`'s input typed from the schema while the list stays `McpTool[]`. */
export function defineTool<Input extends z.ZodObject>(tool: McpTool<Input>): McpTool {
  return tool as unknown as McpTool
}
