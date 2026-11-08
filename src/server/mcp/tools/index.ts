import { z } from 'zod'
import { listMyClasses } from '@/server/classes/service'
import { listLecturerCourses } from '@/server/courses/service'
import { defineTool, type McpTool } from '../tool'
import { draftTools } from './draft-tools'

const whoami = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description: 'The Clasync lecturer this assistant acts as: name, email, language, and how many classes and courses they have.',
  scope: 'clasync:read',
  input: z.object({}),
  run: async (ctx) => {
    const [classes, courses] = await Promise.all([listMyClasses(ctx), listLecturerCourses(ctx)])
    return {
      name: ctx.user.name,
      email: ctx.user.email,
      locale: ctx.user.locale,
      classes: classes.length,
      courses: courses.length,
    }
  },
})

/** Every tool the MCP endpoint offers, in the order assistants see them. */
export const mcpTools: McpTool[] = [whoami, ...draftTools]
