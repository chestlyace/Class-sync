import type { McpTool } from '../tool'
import { assignmentReadTools } from './read-assignments'
import { courseReadTools } from './read-courses'
import { noteReadTools } from './read-notes'
import { testReadTools } from './read-tests'

/** The read tools (`clasync:read`), in the order assistants see them after `whoami`. */
export const readTools: McpTool[] = [...courseReadTools, ...assignmentReadTools, ...testReadTools, ...noteReadTools]
