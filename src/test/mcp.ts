import type { Ctx } from '@/server/core/context'
import { mcpTools } from '@/server/mcp/tools'

/** Runs an MCP tool the way the endpoint does: the input parsed by the tool's own schema. */
export async function callTool(name: string, ctx: Ctx, args: unknown): Promise<unknown> {
  const tool = mcpTools.find((t) => t.name === name)
  if (!tool) throw new Error(`No MCP tool ${name}`)
  return tool.run(ctx, tool.input.parse(args))
}

/** The tool's input schema verdict on `args` (for checking the errors assistants get). */
export function parseToolInput(name: string, args: unknown) {
  const tool = mcpTools.find((t) => t.name === name)
  if (!tool) throw new Error(`No MCP tool ${name}`)
  return tool.input.safeParse(args)
}
