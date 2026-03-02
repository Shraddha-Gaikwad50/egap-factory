"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentSchema = void 0;
const zod_1 = require("zod");
exports.AgentSchema = zod_1.z.object({
    name: zod_1.z.string().min(3, "Name must be at least 3 characters long"),
    role: zod_1.z.string().min(3, "Role must be at least 3 characters long"),
    goal: zod_1.z.string().min(10, "Goal must be at least 10 characters long describes what the agent achieves"),
    systemPrompt: zod_1.z.string().min(50, "System prompt must be at least 50 characters to ensure robust behavior"),
    tools: zod_1.z.array(zod_1.z.string().uuid("Tools must be valid UUIDs")).default([])
});
//# sourceMappingURL=validation.js.map