import type { McpTool } from '../tool'
import { assignmentDraftTools } from './draft-assignments'
import { notesDraftTools } from './draft-notes'
import { testDraftTools } from './draft-tests'

/**
 * The draft tools (`clasync:write`): everything they write stays invisible to students — draft
 * assignments, tests not started, hidden topics, suggestions — until the lecturer approves it in
 * Clasync. None publishes, releases, starts or confirms anything.
 */
export const draftTools: McpTool[] = [...assignmentDraftTools, ...testDraftTools, ...notesDraftTools]
