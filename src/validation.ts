import { z } from 'zod';

export const AgentSchema = z.object({
    name: z.string().min(3, "Name must be at least 3 characters long"),
    role: z.string().min(3, "Role must be at least 3 characters long"),
    goal: z.string().min(10, "Goal must be at least 10 characters long describes what the agent achieves"),
    systemPrompt: z.string().min(50, "System prompt must be at least 50 characters to ensure robust behavior"),
    tools: z.array(z.string().uuid("Tools must be valid UUIDs")).default([])
});

export type CreateAgentInput = z.infer<typeof AgentSchema>;
