
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { PubSub, Message } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyWebsocket from '@fastify/websocket';

// ── Config ───────────────────────────────────────────────────────────
dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID || 'gls-training-486405';
const SUBSCRIPTION_NAME = process.env.SUBSCRIPTION_NAME;
const TOPIC_NAME = process.env.TOPIC_NAME;
const LOCATION = 'asia-south1';
const MODEL_NAME = 'gemini-2.5-flash';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!SUBSCRIPTION_NAME || !TOPIC_NAME) {
    console.error('❌ Missing required env vars: SUBSCRIPTION_NAME and TOPIC_NAME must be set in .env');
    process.exit(1);
}

// ── ESM __dirname ────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Clients ──────────────────────────────────────────────────────────
const prisma = new PrismaClient();
const pubsub = new PubSub({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const subscription = pubsub.subscription(SUBSCRIPTION_NAME);
const topic = pubsub.topic(TOPIC_NAME);

const genAI = new GoogleGenAI({
    project: PROJECT_ID,
    location: LOCATION,
    vertexai: true,
});

const app = Fastify({ logger: true });

// ── Middleware ───────────────────────────────────────────────────────
app.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
});

// ── WebSockets ───────────────────────────────────────────────────────
app.register(fastifyWebsocket);

// Store active connections by agentId (or a unique session ID later)
const activeConnections = new Map<string, any>();

app.register(async function (fastify) {
    // @ts-ignore
    fastify.get('/ws', { websocket: true }, (connection, req) => {
        const agentId = (req.query as any).agentId;
        if (agentId) {
            console.log(`🔌 WebSocket connected for agent: ${agentId}`);
            activeConnections.set(agentId, connection);

            connection.on('close', () => {
                console.log(`🔌 WebSocket disconnected for agent: ${agentId}`);
                activeConnections.delete(agentId);
            });
        } else {
            connection.close();
        }
    });
});

// SPA Fallback: Serve index.html for any 404 that isn't an API call
app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
    }
    reply.status(404).send({ error: 'Not Found', message: `Route ${req.method}:${req.url} not found` });
});

// ── Types ────────────────────────────────────────────────────────────
interface AgentPayload {
    name: string;
    role: string;
    goal: string;
    systemPrompt: string;
    tools: string[];
    budgetUsd?: number;
}

interface ChatPayload {
    agentId: string;
    message: string;
}

/**
 * GET /api/tools
 * List all available tools from the database
 */
app.get('/api/tools', async (_request, _reply) => {
    return await prisma.tool.findMany();
});

/**
 * POST /api/tools
 * Create a new tool blueprint
 */
app.post<{ Body: { name: string, description: string, parameters: any } }>('/api/tools', async (request, reply) => {
    const { name, description, parameters } = request.body;
    try {
        const tool = await prisma.tool.create({
            data: {
                name,
                description,
                configuration: { parameters }
            }
        });
        return reply.status(201).send(tool);
    } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create tool' });
    }
});

/**
 * GET /.well-known/agent.json
 * List all agents
 */
app.get('/.well-known/agent.json', async (_request, _reply) => {
    const agents = await prisma.agent.findMany();
    return { agents: agents };
});

/**
 * GET /api/agents
 * List all agents with tools
 */
app.get('/api/agents', async (_request, _reply) => {
    const agents = await prisma.agent.findMany({
        include: { tools: true },
    });
    return agents;
});

/**
 * POST /api/agents
 * Create a new agent (Blueprint)
 */
app.post<{ Body: AgentPayload }>('/api/agents', async (request, reply) => {
    const { name, role, goal, systemPrompt, tools, budgetUsd } = request.body;

    try {
        const agent = await prisma.agent.create({
            data: {
                name,
                role,
                goal,
                systemPrompt,
                budgetUsd: budgetUsd ?? 5.0,
                tools: {
                    connectOrCreate: tools.map((toolId) => ({
                        where: { name: toolId },
                        create: {
                            name: toolId,
                            description: 'Auto-created tool stub',
                        },
                    })),
                },
            },
        });
        return reply.status(201).send(agent);
    } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create agent' });
    }
});

/**
 * PUT /api/agents/:id
 * Update an existing agent blueprint
 */
app.put<{ Params: { id: string }, Body: AgentPayload }>('/api/agents/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, role, goal, systemPrompt, tools, budgetUsd } = request.body;

    try {
        // ── VERSIONING: Snapshot current state before updating ──
        const current = await prisma.agent.findUnique({
            where: { id },
            include: { tools: true }
        });

        if (current) {
            await prisma.agentVersion.create({
                data: {
                    agentId: id,
                    version: current.currentVersion,
                    name: current.name,
                    role: current.role,
                    goal: current.goal,
                    systemPrompt: current.systemPrompt,
                    toolNames: current.tools.map(t => t.name),
                    changedBy: 'admin',
                }
            });
        }

        const agent = await prisma.agent.update({
            where: { id },
            data: {
                name,
                role,
                goal,
                systemPrompt,
                currentVersion: (current?.currentVersion || 1) + 1,
                ...(budgetUsd !== undefined ? { budgetUsd } : {}),
                tools: {
                    set: [], // Clear existing relations
                    connectOrCreate: tools.map((toolId) => ({
                        where: { name: toolId },
                        create: { name: toolId, description: 'Auto-created tool stub' },
                    })),
                },
            },
            include: { tools: true }
        });
        return reply.send(agent);
    } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to update agent' });
    }
});

/**
 * DELETE /api/agents/:id
 * Delete an agent blueprint and its relations
 */
app.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const { id } = request.params;
    try {
        // Must delete related records first
        await prisma.message.deleteMany({ where: { agentId: id } });
        await prisma.task.deleteMany({ where: { agentId: id } });
        await prisma.usageLog.deleteMany({ where: { agentId: id } });
        await prisma.deployment.deleteMany({ where: { agentId: id } });

        await prisma.agent.delete({ where: { id } });
        return { success: true };
    } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete agent' });
    }
});

/**
 * GET /api/agents/:id/versions
 * Fetch version history for an agent
 */
app.get<{ Params: { id: string } }>('/api/agents/:id/versions', async (request, _reply) => {
    const { id } = request.params;
    const versions = await prisma.agentVersion.findMany({
        where: { agentId: id },
        orderBy: { version: 'desc' }
    });
    return versions;
});

/**
 * POST /api/agents/:id/rollback/:version
 * Rollback an agent to a previous version
 */
app.post<{ Params: { id: string; version: string } }>('/api/agents/:id/rollback/:version', async (request, reply) => {
    const { id, version } = request.params;
    const versionNum = parseInt(version, 10);

    try {
        const snapshot = await prisma.agentVersion.findUnique({
            where: { agentId_version: { agentId: id, version: versionNum } }
        });

        if (!snapshot) {
            return reply.status(404).send({ error: 'Version not found' });
        }

        // Snapshot current state first
        const current = await prisma.agent.findUnique({
            where: { id },
            include: { tools: true }
        });

        if (current) {
            await prisma.agentVersion.create({
                data: {
                    agentId: id,
                    version: current.currentVersion,
                    name: current.name,
                    role: current.role,
                    goal: current.goal,
                    systemPrompt: current.systemPrompt,
                    toolNames: current.tools.map(t => t.name),
                    changedBy: 'admin (rollback)',
                }
            });
        }

        // Restore agent to the snapshot
        const agent = await prisma.agent.update({
            where: { id },
            data: {
                name: snapshot.name,
                role: snapshot.role,
                goal: snapshot.goal,
                systemPrompt: snapshot.systemPrompt,
                currentVersion: (current?.currentVersion || 1) + 1,
                tools: {
                    set: [],
                    connectOrCreate: snapshot.toolNames.map((toolName) => ({
                        where: { name: toolName },
                        create: { name: toolName, description: 'Auto-created tool stub' },
                    })),
                },
            },
            include: { tools: true }
        });

        return reply.send({ success: true, agent, restoredFromVersion: versionNum });
    } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to rollback agent' });
    }
});

/**
 * POST /api/agents/:id/reactivate
 * Reactivate a shutdown agent (resets isActive to true)
 */
app.post<{ Params: { id: string } }>('/api/agents/:id/reactivate', async (request, reply) => {
    const { id } = request.params;
    try {
        const agent = await prisma.agent.update({
            where: { id },
            data: { isActive: true }
        });
        return reply.send({ success: true, agent });
    } catch (err: any) {
        return reply.status(500).send({ error: 'Failed to reactivate agent' });
    }
});

/**
 * POST /api/chat
 * Send a message to an agent via Pub/Sub (Triggering Orchestrator Worker)
 */
app.post<{ Body: ChatPayload }>('/api/chat', async (request, reply) => {
    const { agentId, message } = request.body;

    if (!agentId || !message) {
        return reply.status(400).send({ error: 'Missing agentId or message' });
    }

    try {
        // Save User Message
        const userMsg = await prisma.message.create({
            data: {
                agentId,
                role: 'user',
                content: message,
            },
        });

        const traceId = randomUUID();

        // Also publish to Pub/Sub for ingress tracking (fire-and-forget)
        topic.publishMessage({
            data: Buffer.from(JSON.stringify({ type: 'TRACE_ONLY', agentId, traceId })),
        }).catch(() => { }); // Swallow errors — this is just for trace counting

        // Process chat INLINE (not via Pub/Sub) — this is critical for Cloud Run
        // which scales to zero and can't maintain a pull subscription
        const chatData = {
            type: 'CHAT',
            agentId,
            message,
            traceId,
            dbMessageId: userMsg.id,
        };

        // Fire the processing as a background task (don't await — return 200 immediately)
        processChat(chatData).catch(err => {
            console.error('❌ Inline chat processing error:', err);
        });

        return { status: 'sent', messageId: traceId, userMessage: userMsg };
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to process chat' });
    }
});

/**
 * GET /api/agents/:id/messages
 * Fetch chat history for an agent
 */
app.get<{ Params: { id: string } }>('/api/agents/:id/messages', async (request, _reply) => {
    const { id } = request.params;
    const messages = await prisma.message.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'asc' },
    });
    return messages;
});

/**
 * DELETE /api/agents/:id/messages
 * Clear chat history for an agent
 */
app.delete<{ Params: { id: string } }>('/api/agents/:id/messages', async (request, reply) => {
    const { id } = request.params;
    try {
        await prisma.message.deleteMany({ where: { agentId: id } });
        return { success: true };
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to clear chat history' });
    }
});

// ── COMMAND PLANE API ────────────────────────────────────────────────

// 1. SAFETY: Emergency Stop
app.get('/api/settings/emergency', async (_req, _rep) => {
    const setting = await prisma.globalSettings.findUnique({ where: { key: 'emergency_stop' } });
    return { active: setting?.value ? (setting.value as any).active : false };
});

app.post<{ Body: { active: boolean } }>('/api/settings/emergency', async (req, _rep) => {
    const { active } = req.body;
    const setting = await prisma.globalSettings.upsert({
        where: { key: 'emergency_stop' },
        update: { value: { active, updatedAt: new Date() } },
        create: { key: 'emergency_stop', value: { active, updatedAt: new Date() } }
    });
    return setting;
});

// 2. GOVERNANCE: HITL Tasks
app.get('/api/tasks', async (_req, _rep) => {
    return await prisma.task.findMany({
        where: { status: 'PENDING' },
        include: { agent: true },
        orderBy: { createdAt: 'desc' }
    });
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/approve', async (req, rep) => {
    const { id } = req.params;
    try {
        const task = await prisma.task.update({
            where: { id },
            data: { status: 'APPROVED' },
            include: { agent: true } // Need agent details to resume
        });

        // ── SIGNAL: Publish RESUME message to Pub/Sub ─────────────────
        const payload = {
            type: 'RESUME',
            taskId: task.id,
            agentId: task.agentId,
            traceId: randomUUID(),
            action: 'APPROVED'
        };

        const topic = pubsub.topic(TOPIC_NAME);
        await topic.publishMessage({
            data: Buffer.from(JSON.stringify(payload)),
            attributes: {
                source: 'governance-api',
                traceId: payload.traceId
            }
        });
        console.log(`📢 Sent RESUME signal for Task ${task.id} (Agent ${task.agent.name})`);
        // ─────────────────────────────────────────────────────────────

        return task;
    } catch (e) {
        console.error(e);
        return rep.status(404).send({ error: 'Task not found or failed to signal' });
    }
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/reject', async (req, rep) => {
    const { id } = req.params;
    try {
        const task = await prisma.task.update({
            where: { id },
            data: { status: 'REJECTED' }
        });
        return task;
    } catch (e) {
        return rep.status(404).send({ error: 'Task not found' });
    }
});

// 2b. GOVERNANCE: Edit Task Payload Before Approval
app.put<{ Params: { id: string }, Body: { inputPayload?: any; description?: string } }>('/api/tasks/:id', async (req, rep) => {
    const { id } = req.params;
    const { inputPayload, description } = req.body;

    try {
        // Only allow editing PENDING tasks
        const existing = await prisma.task.findUnique({ where: { id } });
        if (!existing) {
            return rep.status(404).send({ error: 'Task not found' });
        }
        if (existing.status !== 'PENDING') {
            return rep.status(400).send({ error: `Cannot edit a task with status '${existing.status}'. Only PENDING tasks can be edited.` });
        }

        const updateData: any = {};
        if (inputPayload !== undefined) updateData.inputPayload = inputPayload;
        if (description !== undefined) updateData.description = description;

        const task = await prisma.task.update({
            where: { id },
            data: updateData,
            include: { agent: true }
        });

        console.log(`✏️ Task ${id} payload edited before approval`);
        return task;
    } catch (e) {
        console.error(e);
        return rep.status(500).send({ error: 'Failed to update task' });
    }
});

// 3. OBSERVABILITY: Dashboard Stats
app.get('/api/dashboard/stats', async (_req, _rep) => {
    // 1. Cost Accounting: Sum up all message costs
    const costAgg = await prisma.message.aggregate({
        _sum: { cost: true }
    });
    const totalCost = costAgg._sum.cost || 0.0;

    const activeAgents = await prisma.agent.count();
    const pendingTasks = await prisma.task.count({ where: { status: 'PENDING' } });

    // 2. Zombie Detection: Tasks stuck in PENDING/RUNNING for > 10 mins
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const zombieCount = await prisma.task.count({
        where: {
            status: { in: ['PENDING', 'RUNNING'] },
            updatedAt: { lt: tenMinutesAgo }
        }
    });

    // Fetch recent traces (last 50)
    const traces = await prisma.traceSpan.findMany({
        where: { parentId: null }, // Root spans only
        orderBy: { startedAt: 'desc' },
        take: 50
    });

    // 3. Per-Agent Cost Breakdown
    const agentCosts = await prisma.usageLog.groupBy({
        by: ['agentId'],
        _sum: { costUsd: true, tokens: true },
        _count: { id: true }
    });
    const allAgents = await prisma.agent.findMany({ select: { id: true, name: true } });
    const agentMap = new Map(allAgents.map(a => [a.id, a.name]));
    const perAgentCosts = agentCosts.map((ac: any) => ({
        agentId: ac.agentId,
        agentName: agentMap.get(ac.agentId) || 'Unknown',
        totalCost: ac._sum.costUsd || 0,
        totalTokens: ac._sum.tokens || 0,
        invocations: ac._count.id || 0
    }));

    return {
        totalCost,
        activeAgents,
        pendingTasks,
        zombieCount,
        traces,
        perAgentCosts
    };
});

// 3b. ANALYTICS: Cost Time-Series (Last 30 Days)
app.get('/api/dashboard/cost-timeseries', async (_req, _rep) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch all usage logs from the last 30 days
    const logs = await prisma.usageLog.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { agentId: true, costUsd: true, tokens: true, createdAt: true }
    });

    // Get agent names
    const allAgents = await prisma.agent.findMany({ select: { id: true, name: true } });
    const agentMap = new Map(allAgents.map(a => [a.id, a.name]));

    // Aggregate by date + agent
    const dailyMap = new Map<string, { date: string; agentId: string; agentName: string; totalCost: number; totalTokens: number }>();

    for (const log of logs) {
        const dateKey = log.createdAt.toISOString().split('T')[0] ?? ''; // YYYY-MM-DD
        const key = `${dateKey}__${log.agentId}`;

        if (!dailyMap.has(key)) {
            dailyMap.set(key, {
                date: dateKey,
                agentId: log.agentId,
                agentName: agentMap.get(log.agentId) || 'Unknown',
                totalCost: 0,
                totalTokens: 0,
            });
        }

        const entry = dailyMap.get(key)!;
        entry.totalCost += log.costUsd;
        entry.totalTokens += log.tokens;
    }

    // Sort by date
    const timeseries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Also compute per-agent totals for the bar chart
    const agentTotals = new Map<string, { agentName: string; totalCost: number; totalTokens: number }>();
    for (const entry of timeseries) {
        if (!agentTotals.has(entry.agentId)) {
            agentTotals.set(entry.agentId, { agentName: entry.agentName, totalCost: 0, totalTokens: 0 });
        }
        const t = agentTotals.get(entry.agentId)!;
        t.totalCost += entry.totalCost;
        t.totalTokens += entry.totalTokens;
    }

    return {
        timeseries,
        agentTotals: Array.from(agentTotals.entries()).map(([agentId, data]) => ({
            agentId,
            ...data
        }))
    };
});

// 4. RECONCILIATION: Audit Report
app.get('/api/reports/reconciliation', async (_req, _rep) => {
    // Total ingress events (messages sent by users)
    const totalIngressEvents = await prisma.message.count({
        where: { role: 'user' }
    });

    // Total tasks created (HITL interceptions)
    const totalTasksCreated = await prisma.task.count();

    // Tasks by status
    const pendingTasks = await prisma.task.count({ where: { status: 'PENDING' } });
    const approvedTasks = await prisma.task.count({ where: { status: 'APPROVED' } });
    const completedTasks = await prisma.task.count({ where: { status: 'COMPLETED' } });
    const rejectedTasks = await prisma.task.count({ where: { status: 'REJECTED' } });

    // Total assistant responses (successful completions)
    const totalResponses = await prisma.message.count({
        where: { role: 'assistant' }
    });

    // Cost summary
    const costAgg = await prisma.message.aggregate({
        _sum: { cost: true, tokens: true }
    });

    // Unresolved: Events that didn't result in a response or task
    const unresolvedCount = Math.max(0, totalIngressEvents - totalResponses - pendingTasks);

    return {
        report: 'EGAP Reconciliation Report',
        generatedAt: new Date().toISOString(),
        summary: {
            totalIngressEvents,
            totalResponses,
            totalTasksCreated,
            unresolvedCount,
        },
        taskBreakdown: {
            pending: pendingTasks,
            approved: approvedTasks,
            completed: completedTasks,
            rejected: rejectedTasks,
        },
        costSummary: {
            totalTokens: costAgg._sum.tokens || 0,
            totalCostUsd: costAgg._sum.cost || 0.0,
        },
        health: unresolvedCount === 0 ? 'HEALTHY' : 'ATTENTION_NEEDED',
    };
});



// ── Extracted Chat Processor (Shared by HTTP handler and Pub/Sub worker) ──
async function processChat(data: { type: string; agentId: string; message: string; traceId: string; dbMessageId?: string }): Promise<void> {
    const startTimeMs = Date.now();
    let opStatus = 'OK';

    try {
        // ── SAFETY CHECK: Emergency Stop ──────────────────────────────
        const globalSettings = await prisma.globalSettings.findUnique({
            where: { key: 'emergency_stop' }
        });

        if ((globalSettings?.value as any)?.active === true) {
            console.error('🛑 SAFETY TRIGGER: System is in EMERGENCY STOP mode. Dropping message.');
            return;
        }

        const agentId = data.agentId;
        console.log(`🧠 Processing CHAT message for Agent ${agentId} (Model: ${MODEL_NAME})`);

        const agent = await prisma.agent.findUnique({
            where: { id: agentId },
            include: { tools: true }
        });

        if (!agent) {
            console.error(`❌ Agent ${agentId} not found`);
            return;
        }

        // Fetch conversation history
        const history = await prisma.message.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        const chatHistory = history.reverse().map((msg: any) => ({
            role: msg.role === 'admin' ? 'user' : (msg.role === 'user' ? 'user' : 'model'),
            parts: [{ text: msg.content }]
        }));

        // ── AGENT ACTIVE CHECK ────────────────────────────────────────
        if (!agent.isActive) {
            console.error(`🛑 AGENT SHUTDOWN: Agent ${agentId} is deactivated.`);
            await prisma.message.create({
                data: { agentId, role: 'assistant', content: `[System] ⚠️ This agent has been shut down (budget exceeded or manually deactivated). An admin must reactivate it.` }
            });
            return;
        }

        // ── BUDGET GUARDRAIL (Dynamic per-agent) ─────────────────────
        const allMessages = await prisma.message.findMany({
            where: { agentId },
            select: { cost: true }
        });
        const currentSpend = allMessages.reduce((sum: number, msg: any) => sum + (msg.cost || 0), 0);
        const agentBudget = agent.budgetUsd ?? 5.0;

        if (currentSpend >= agentBudget) {
            console.error(`🛑 BUDGET LIMIT: Agent ${agentId} spent $${currentSpend.toFixed(4)} (Limit: $${agentBudget.toFixed(2)}) — AUTO-SHUTDOWN`);
            // Auto-shutdown the agent
            await prisma.agent.update({ where: { id: agentId }, data: { isActive: false } });
            await prisma.message.create({
                data: { agentId, role: 'assistant', content: `[System] 🛑 Agent budget limit reached ($${currentSpend.toFixed(4)} / $${agentBudget.toFixed(2)}). Agent has been automatically shut down. Contact an admin to reactivate.` }
            });
            return;
        }

        // ── DYNAMIC TOOL COMPILATION ─────────────────────────────────
        const dynamicFunctionDeclarations = agent.tools.map((t: any) => {
            const config: any = t.configuration;
            return { name: t.name, description: t.description, parameters: config?.parameters || {} };
        });

        const dynamicTools = dynamicFunctionDeclarations.length > 0 ? [{ functionDeclarations: dynamicFunctionDeclarations }] : [];
        const allowedFunctionNames = agent.tools.map((t: any) => t.name);

        // Start Chat Session (STREAMING)
        const chat = genAI.chats.create({
            model: MODEL_NAME,
            config: {
                systemInstruction: {
                    parts: [
                        { text: agent.systemPrompt },
                        { text: "CRITICAL: You are an agent with access to function calling tools. You must use valid function calls. DO NOT generate Python code or usage of `print()`. Use the tools provided directly." }
                    ]
                },
                maxOutputTokens: 1000,
            },
            history: chatHistory,
            // @ts-ignore
            tools: dynamicTools as any,
            toolConfig: dynamicFunctionDeclarations.length > 0 ? {
                functionCallingConfig: { mode: 'ANY', allowedFunctionNames }
            } : undefined
        });

        console.log(`🤖 Sending streaming message to Vertex AI...`);

        // @ts-ignore
        const streamResult = await chat.sendMessageStream({ message: data.message });

        let fullResponseText = "";
        let usageMetadata: any = null;
        let finalCandidate: any = null;
        const wsSocket = activeConnections.get(agentId);

        // @ts-ignore
        for await (const chunk of streamResult) {
            // @ts-ignore
            const chunkCandidates = chunk.candidates || chunk.response?.candidates;
            const chunkText = chunkCandidates?.[0]?.content?.parts?.[0]?.text;

            if (chunkText) {
                fullResponseText += chunkText;
                if (wsSocket) {
                    wsSocket.send(JSON.stringify({ type: 'thought_chunk', text: chunkText }));
                }
            }

            if (chunk.usageMetadata !== undefined) usageMetadata = chunk.usageMetadata;
            // @ts-ignore
            else if (chunk.response?.usageMetadata !== undefined) usageMetadata = chunk.response.usageMetadata;
            if (chunkCandidates?.[0]) finalCandidate = chunkCandidates[0];
        }

        const result = { usageMetadata, candidates: finalCandidate ? [finalCandidate] : [] };

        // ── COST ACCOUNTING ──────────────────────────────────────────
        const usage = result.usageMetadata;
        const inputTokens = usage?.promptTokenCount || 0;
        const outputTokens = usage?.candidatesTokenCount || 0;
        const totalTokens = usage?.totalTokenCount || 0;
        const cost = (inputTokens * 0.00001875 / 1000) + (outputTokens * 0.000075 / 1000);
        console.log(`💰 Cost: $${cost.toFixed(6)} (${totalTokens} tokens)`);

        if (data.dbMessageId) {
            await prisma.message.update({
                where: { id: data.dbMessageId },
                data: { tokens: totalTokens, cost }
            });
        }

        // ── RESPONSE HANDLING ────────────────────────────────────────
        // @ts-ignore
        const candidates = result.candidates || result.response?.candidates;
        const firstCandidate = candidates?.[0];
        let firstPart = firstCandidate?.content?.parts?.[0];

        // 🚨 FALLBACK: Handle UNEXPECTED_TOOL_CALL
        if (firstCandidate?.finishReason === 'UNEXPECTED_TOOL_CALL' && firstCandidate?.finishMessage) {
            const rawMsg = firstCandidate.finishMessage;
            const match = rawMsg.match(/print\(([\w_]+)\((.*)\)\)/);
            if (match) {
                const fnName = match[1];
                const argsStr = match[2];
                const args: any = {};
                const argMatches = argsStr.matchAll(/(\w+)=['"]([\s\S]*?)['"]/g);
                for (const m of argMatches) { args[m[1]] = m[2]; }
                firstPart = { functionCall: { name: fnName, args } };
            }
        }

        // ── FUNCTION CALLING ─────────────────────────────────────────
        // @ts-ignore
        if (firstPart?.functionCall) {
            const fn = firstPart.functionCall;
            console.log(`⚡️ Agent wants to call tool: ${fn.name}`);

            if (fn.name === 'send_email') {
                const task = await prisma.task.create({
                    data: { description: `Agent wants to send email to ${fn.args.recipient}`, status: 'PENDING', agentId: agent.id, inputPayload: fn.args, traceId: data.traceId || null }
                });
                await prisma.message.create({ data: { agentId: agent.id, role: 'assistant', content: `[System] Usage of tool '${fn.name}' requires Admin Approval. Task ${task.id} created.`, tokens: totalTokens, cost } });
                await prisma.usageLog.create({ data: { agentId: agent.id, action: `tool_intercept_${fn.name}`, tokens: totalTokens, costUsd: cost } });
                console.log(`🔒 Task ${task.id} created. Suspending execution.`);
                return;
            }

            if (fn.name === 'search_vertex_docs') {
                const output = `Found docs for query '${fn.args.query}': Vertex AI is Google's fully managed AI platform...`;
                await prisma.message.create({ data: { agentId: agent.id, role: 'assistant', content: `(Tool: ${fn.name}) ${output}`, tokens: totalTokens, cost } });
                await prisma.usageLog.create({ data: { agentId: agent.id, action: `tool_execute_${fn.name}`, tokens: totalTokens, costUsd: cost } });
                return;
            }

            if (fn.name === 'save_file') {
                const bucketName = `${PROJECT_ID}_cloudbuild`;
                try {
                    await storage.bucket(bucketName).file(fn.args.filename).save(fn.args.content);
                    await prisma.message.create({ data: { agentId: agent.id, role: 'assistant', content: `(Tool: ${fn.name}) Successfully saved ${fn.args.filename} to GCS.`, tokens: totalTokens, cost } });
                    await prisma.usageLog.create({ data: { agentId: agent.id, action: `tool_execute_${fn.name}`, tokens: totalTokens, costUsd: cost } });
                } catch (err: any) {
                    await prisma.message.create({ data: { agentId: agent.id, role: 'assistant', content: `(Tool Error: ${fn.name}) ${err.message}`, tokens: totalTokens, cost } });
                    await prisma.usageLog.create({ data: { agentId: agent.id, action: `tool_error_${fn.name}`, tokens: totalTokens, costUsd: cost } });
                }
                return;
            }
        }

        // Normal Text Response
        const responseText = firstPart?.text || "I'm sorry, I couldn't generate a response.";
        console.log(`✅ Vertex Response: ${responseText.substring(0, 50)}...`);
        await prisma.message.create({ data: { agentId: agent.id, role: 'assistant', content: responseText, tokens: totalTokens, cost } });
        await prisma.usageLog.create({ data: { agentId: agent.id, action: 'llm_inference', tokens: totalTokens, costUsd: cost } });

    } catch (err: any) {
        opStatus = 'ERROR';
        console.error('❌ processChat error:', err);
        throw err;
    } finally {
        if (data.traceId) {
            await prisma.traceSpan.create({
                data: { traceId: data.traceId, service: 'orchestrator', operation: 'chat_completion', status: opStatus, durationMs: Date.now() - startTimeMs }
            }).catch((e: any) => console.error('Failed to log TraceSpan:', e));
        }
    }
}



// ── Worker Handler (The Brain) ───────────────────────────────────────
async function handleMessage(message: Message): Promise<void> {
    const startTimeMs = Date.now();
    let traceId: string | null = null;
    let opStatus = 'OK';
    let operationName = 'process_message';

    try {
        const data = JSON.parse(message.data.toString());
        traceId = data.traceId || null;
        if (data.type === 'RESUME') operationName = 'resume_task';
        if (data.type === 'CHAT') operationName = 'chat_completion';

        console.log(`📩 Received message ${message.id} (${data.type})`);

        // ── RESUME SIGNAL (From HITL Approval) ────────────────────────
        if (data.type === 'RESUME') {
            const { taskId, agentId, action } = data;
            console.log(`▶️ RESUME Signal received for Task ${taskId} (${action})`);

            if (action !== 'APPROVED') {
                console.log('Skipping non-approved resume signal.');
                message.ack();
                return;
            }

            const task = await prisma.task.findUnique({ where: { id: taskId } });
            if (!task || !task.inputPayload) {
                console.error(`❌ Task ${taskId} missing or has no payload.`);
                message.ack();
                return;
            }

            const payload = task.inputPayload as any;

            // Execute Action
            let toolOutput = '';
            if (payload.recipient && payload.subject && payload.body) {
                // Heuristic: It's send_email
                console.log(`📧 Sending Email to ${payload.recipient}...`);
                console.log(`Subject: ${payload.subject}`);
                console.log(`Body: ${payload.body}`);
                // In real app: await sendEmail(...)
                toolOutput = `[System] Email sent to ${payload.recipient}`;
            } else {
                toolOutput = `[System] Approved action executed: ${JSON.stringify(payload)}`;
            }

            console.log(`✅ Action Executed for Task ${taskId}`);

            // Update Task Status
            await prisma.task.update({
                where: { id: taskId },
                data: { status: 'COMPLETED' }
            });

            // Notify Chat
            const agent = await prisma.agent.findUnique({ where: { id: agentId } });
            if (agent) {
                // Save confirmation message
                await prisma.message.create({
                    data: {
                        agentId,
                        role: 'assistant',
                        content: toolOutput
                    }
                });
            }

            message.ack();
            return;
        }

        if (data.type === 'CHAT') {
            await processChat(data);
            message.ack();
            return;
        }

        console.log('⚠️ Unknown message type. Acknowledging.');
        message.ack();

    } catch (err: any) {
        opStatus = 'ERROR';
        console.error(`⚠️  Error processing message:`, err);
        message.nack(); // Retry on error
    } finally {
        if (traceId) {
            await prisma.traceSpan.create({
                data: {
                    traceId,
                    service: 'orchestrator',
                    operation: operationName,
                    status: opStatus,
                    durationMs: Date.now() - startTimeMs
                }
            }).catch(e => console.error('Failed to log TraceSpan:', e));
        }
    }
}

// ── Start Service ────────────────────────────────────────────────────
const start = async () => {
    try {
        // Start API
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log('──────────────────────────────────────────────');
        console.log(`🚀 EGAP Orchestrator (Monolith) is ACTIVE`);
        console.log(`   API Endpoint : http://localhost:${PORT}`);
        console.log(`   Worker       : Listening on ${SUBSCRIPTION_NAME}`);
        console.log(`   Vertex SDK   : ${MODEL_NAME} @ ${LOCATION}`);
        console.log('──────────────────────────────────────────────');

        // Start Worker
        subscription.on('message', handleMessage);
        subscription.on('error', (err: Error) => console.error('🚨 Subscription error:', err.message));

    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
