
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { PubSub, Message } from '@google-cloud/pubsub';
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

// ── Types ────────────────────────────────────────────────────────────
interface AgentPayload {
    name: string;
    role: string;
    goal: string;
    systemPrompt: string;
    tools: string[];
}

interface ChatPayload {
    agentId: string;
    message: string;
}

// ── API Routes (The Factory Interface) ───────────────────────────────

/**
 * GET /api/tools
 * Mock list of available tools (Phase 1 Stub integration)
 */
app.get('/api/tools', async (_request, _reply) => {
    return [
        { id: 'search_vertex_docs', name: 'search_vertex_docs', description: 'Search Vertex AI Documentation' },
        { id: 'send_email', name: 'send_email', description: 'Send an email via SMTP' },
        { id: 'save_file', name: 'save_file', description: 'Save content to Cloud Storage' },
    ];
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
    const { name, role, goal, systemPrompt, tools } = request.body;

    try {
        const agent = await prisma.agent.create({
            data: {
                name,
                role,
                goal,
                systemPrompt,
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

        // Publish to Pub/Sub
        const event = {
            type: 'CHAT',
            agentId,
            message,
            traceId: randomUUID(),
            dbMessageId: userMsg.id, // Pass DB ID to worker
        };

        const messageId = await topic.publishMessage({
            data: Buffer.from(JSON.stringify(event)),
        });

        return { status: 'sent', messageId, userMessage: userMsg };
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

    return {
        totalCost,
        activeAgents,
        pendingTasks,
        zombieCount,
        traces
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


// ── Tool Definitions ─────────────────────────────────────────────────
const tools = [
    {
        functionDeclarations: [ // camelCase for SDK
            {
                name: "search_vertex_docs",
                description: "Search the Vertex AI documentation for technical information.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        query: { type: "STRING", description: "The search query." }
                    },
                    required: ["query"]
                }
            },
            {
                name: "send_email",
                description: "Send an email to a recipient. REQUIRES HUMAN APPROVAL.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        recipient: { type: "STRING", description: "Email address of recipient." },
                        subject: { type: "STRING", description: "Subject line." },
                        body: { type: "STRING", description: "Email body content." }
                    },
                    required: ["recipient", "subject", "body"]
                }
            }
        ]
    }
];

// ── Worker Handler (The Brain) ───────────────────────────────────────
async function handleMessage(message: Message): Promise<void> {
    try {
        const data = JSON.parse(message.data.toString());
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
            // ── SAFETY CHECK: Emergency Stop ──────────────────────────────
            const globalSettings = await prisma.globalSettings.findUnique({
                where: { key: 'emergency_stop' }
            });

            if ((globalSettings?.value as any)?.active === true) {
                console.error('🛑 SAFETY TRIGGER: System is in EMERGENCY STOP mode. Dropping message.');
                // We Ack it to remove it from queue so it doesn't loop. 
                // Alternatively we could Nack if we want to process it *after* stop is lifted, 
                // but "Emergency Stop" usually means "Kill everything now".
                // Let's Ack and maybe log a "Cancelled" status in DB if possible.
                message.ack();
                return;
            }
            // ─────────────────────────────────────────────────────────────

            const agentId = data.agentId;
            console.log(`🧠 Processing CHAT message for Agent ${agentId} (Model: ${MODEL_NAME})`);

            const agent = await prisma.agent.findUnique({
                where: { id: agentId },
                include: { tools: true }
            });

            if (!agent) {
                console.error(`❌ Agent ${agentId} not found`);
                message.ack();
                return;
            }

            // Fetch conversation history
            const history = await prisma.message.findMany({
                where: { agentId: agentId },
                orderBy: { createdAt: 'desc' },
                take: 10 // Limit context
            });

            const chatHistory = history.reverse().map(msg => ({
                role: msg.role === 'admin' ? 'user' : (msg.role === 'user' ? 'user' : 'model'),
                parts: [{ text: msg.content }]
            }));

            // Start Chat Session
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
                // @ts-ignore - SDK types don't include tools but it works at runtime
                tools: tools as any, // Inject Tools
                toolConfig: {
                    functionCallingConfig: {
                        mode: 'ANY',
                        allowedFunctionNames: ['send_email', 'search_vertex_docs']
                    }
                }
            });

            console.log(`🤖 Sending message to Vertex AI...`);

            // @ts-ignore
            const result = await chat.sendMessage({
                message: data.message
            });

            console.log('----- DEBUG RESULT -----');
            console.log(JSON.stringify(result, null, 2));
            console.log('------------------------');

            // ── COST ACCOUNTING ──────────────────────────────────────────
            // @ts-ignore
            const usage = result.usageMetadata;
            const inputTokens = usage?.promptTokenCount || 0;
            const outputTokens = usage?.candidatesTokenCount || 0;
            const totalTokens = usage?.totalTokenCount || 0;

            // Gemini 1.5 Flash Pricing (Approx)
            const cost = (inputTokens * 0.00001875 / 1000) + (outputTokens * 0.000075 / 1000); // 1.5 Flash < 128k context
            console.log(`💰 Cost: $${cost.toFixed(6)} (${totalTokens} tokens)`);

            // Save Cost to Message
            if (data.dbMessageId) {
                await prisma.message.update({
                    where: { id: data.dbMessageId },
                    data: {
                        tokens: totalTokens,
                        cost: cost
                    }
                });
            } else {
                console.warn('⚠️ No dbMessageId in payload, skipping cost update.');
            }

            // ── RESPONSE HANDLING ────────────────────────────────────────
            // @ts-ignore
            const candidates = result.candidates || result.response?.candidates;
            const firstCandidate = candidates?.[0];
            let firstPart = firstCandidate?.content?.parts?.[0];

            // 🚨 FALLBACK: Handle UNEXPECTED_TOOL_CALL (Gemini 2.5 Flash Python Output)
            if (firstCandidate?.finishReason === 'UNEXPECTED_TOOL_CALL' && firstCandidate?.finishMessage) {
                console.log('⚠️ Handling UNEXPECTED_TOOL_CALL fallback...');
                const rawMsg = firstCandidate.finishMessage;
                // Expected format: "Unexpected tool call: print(send_email(recipient='...', ...))"
                // Regex to extract function name and args string
                const match = rawMsg.match(/print\(([\w_]+)\((.*)\)\)/);
                if (match) {
                    const fnName = match[1];
                    const argsStr = match[2];

                    // Simple heuristic parser for python-style kwargs (recipient='val', subject='val')
                    // This is brittle but necessary for the 2.5 Flash behavior
                    const args: any = {};
                    const argMatches = argsStr.matchAll(/(\w+)=['"]([^'"]*)['"]/g);
                    for (const m of argMatches) {
                        args[m[1]] = m[2];
                    }

                    console.log(`🔧 Parsed Fallback Function Call: ${fnName}`, args);

                    // Mock the functionCall object so the loop below handles it
                    firstPart = {
                        functionCall: {
                            name: fnName,
                            args: args
                        }
                    };
                }
            }

            // ── FUNCTION CALLING LOOP ────────────────────────────────────
            // @ts-ignore
            if (firstPart?.functionCall) {
                const fn = firstPart.functionCall;
                console.log(`⚡️ Agent wants to call tool: ${fn.name}`);

                // HITL CHECK for 'send_email'
                if (fn.name === 'send_email') {
                    console.log(`✋ HIGH RISK ACTION INTERCEPTED: ${fn.name}`);

                    // Create Pending Task
                    const task = await prisma.task.create({
                        data: {
                            description: `Agent wants to send email to ${fn.args.recipient}`,
                            status: 'PENDING',
                            agentId: agent.id,
                            inputPayload: fn.args, // Save args to execute later
                            traceId: data.traceId || null // Link to ingress trace
                        }
                    });

                    // Save 'Assistant' message indicating hold
                    await prisma.message.create({
                        data: {
                            agentId: agent.id,
                            role: 'assistant',
                            content: `[System] Usage of tool '${fn.name}' requires Admin Approval. Task ${task.id} created.`,
                            tokens: totalTokens,
                            cost: cost
                        }
                    });

                    console.log(`🔒 Task ${task.id} created. Suspending execution.`);
                    message.ack();
                    return;
                }

                // Execute SAFE tools immediately
                if (fn.name === 'search_vertex_docs') {
                    // Mock execution
                    const output = `Found docs for query '${fn.args.query}': Vertex AI is Google's fully managed AI platform...`;
                    console.log(`✅ Auto-executed Safe Tool: ${fn.name}`);

                    // 🔄 RECURSION: Send tool output back to model
                    // In a real loop we'd call sendMessage again with functionResponse.
                    // For this demo, we'll just save the output as a message to move forward.
                    await prisma.message.create({
                        data: {
                            agentId: agent.id,
                            role: 'assistant',
                            content: `(Tool: ${fn.name}) ${output}`,
                            tokens: totalTokens,
                            cost: cost
                        }
                    });
                    message.ack();
                    return;
                }
            }

            // Normal Text Response
            const responseText = firstPart?.text || "I'm sorry, I couldn't generate a response.";
            console.log(`✅ Vertex Response: ${responseText.substring(0, 50)}...`);

            await prisma.message.create({
                data: {
                    agentId: agent.id,
                    role: 'assistant',
                    content: responseText,
                    tokens: totalTokens,
                    cost: cost
                }
            });

            message.ack();
            return;
        }

        console.log('⚠️ Unknown message type. Acknowledging.');
        message.ack();

    } catch (err: any) {
        console.error(`⚠️  Error processing message:`, err);
        message.nack(); // Retry on error
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
