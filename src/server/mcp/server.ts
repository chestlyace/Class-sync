import type { CallToolResult } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'mcp-handler'
import { AppError } from '@/server/core/errors'
import type { McpCaller } from './auth'
import type { McpTool } from './tool'
import { mcpTools } from './tools'

const SERVER_INFO = { name: 'clasync', version: '1.0.0' }

const INSTRUCTIONS =
  'Clasync is a class-management app. You act as the signed-in lecturer, with their permissions. ' +
  'You can read their courses and draft work; drafts stay invisible to students until the lecturer ' +
  'approves them in Clasync. You cannot publish, release, start tests or send emails.'

function errorResult(payload: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function successResult(result: unknown): CallToolResult {
  const text = JSON.stringify(result ?? null)
  const isRecord = typeof result === 'object' && result !== null && !Array.isArray(result)
  return isRecord
    ? { content: [{ type: 'text', text }], structuredContent: result as Record<string, unknown> }
    : { content: [{ type: 'text', text }] }
}

/** Runs one tool for the caller: scope check, AppError → tool error, one log line per call. */
export async function runTool(tool: McpTool, caller: McpCaller, args: unknown): Promise<CallToolResult> {
  const started = Date.now()
  let outcome = 'ok'
  try {
    if (!caller.scopes.includes(tool.scope)) {
      outcome = 'SCOPE'
      return errorResult({
        error: 'INSUFFICIENT_SCOPE',
        message: `This tool needs the ${tool.scope} permission; reconnect the assistant and allow it.`,
        requiredScope: tool.scope,
      })
    }
    const result = await tool.run(caller.ctx, args as never)
    return successResult(result)
  } catch (err) {
    if (err instanceof AppError) {
      outcome = err.code
      return errorResult({ error: err.code, message: err.message, ...err.details })
    }
    outcome = 'ERROR'
    // Server-side only: the error, never the request's token.
    console.error(`[mcp] ${tool.name} failed`, err)
    return errorResult({ error: 'INTERNAL', message: 'Something went wrong in Clasync. Try again.' })
  } finally {
    console.info(`[mcp] ${caller.ctx.user.id} ${tool.name} ${Date.now() - started}ms ${outcome}`)
  }
}

/** The MCP request handler for one authenticated caller (stateless streamable HTTP). */
export function createMcpServerHandler(caller: McpCaller, tools: McpTool[] = mcpTools): (req: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => {
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.input,
            annotations: { readOnlyHint: tool.scope === 'clasync:read', destructiveHint: false, openWorldHint: false },
          },
          (args) => runTool(tool, caller, args),
        )
      }
    },
    { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS },
  )
}
