import { z } from 'zod';
export declare const AgentSchema: z.ZodObject<{
    name: z.ZodString;
    role: z.ZodString;
    goal: z.ZodString;
    systemPrompt: z.ZodString;
    tools: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type CreateAgentInput = z.infer<typeof AgentSchema>;
//# sourceMappingURL=validation.d.ts.map