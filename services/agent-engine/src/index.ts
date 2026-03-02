import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

// ── Config ───────────────────────────────────────────────────────────
dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID || 'gls-training-486405';
const LOCATION = 'asia-south1';
const MODEL_NAME = 'gemini-2.5-flash';
const PORT = parseInt(process.env.PORT || '8080', 10);
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

// TRUE MULTI-SERVICE ROUTING: Each deployment knows exactly which agent it is.
const AGENT_ID = process.env.AGENT_ID;

if (!AGENT_ID) {
    console.error('❌ FATAL: AGENT_ID environment variable is missing.');
    console.error('Each isolated service instance must be configured with an AGENT_ID.');
    process.exit(1);
}

// ── Clients ──────────────────────────────────────────────────────────
const prisma = new PrismaClient();
const genAI = new GoogleGenAI({
    project: PROJECT_ID,
    location: LOCATION,
    vertexai: true,
});

const app = Fastify({ logger: true });

// ── Types ────────────────────────────────────────────────────────────
interface ChatPayload {
    message: string;
    traceId?: string;
}

// ── Routes ───────────────────────────────────────────────────────────

app.get('/health', async () => {
    return { status: 'ok', service: `agent-engine-${AGENT_ID}` };
});

/**
 * POST /chat
 * Execute the agent's logic for a given message.
 * Note: We don't need the agentId in the body because this service is DEDICATED to one agent.
 */
app.post<{ Body: ChatPayload }>('/chat', async (request, reply) => {
    const { message, traceId } = request.body;

    if (!message) {
        return reply.status(400).send({ error: 'Missing message in payload' });
    }

    const effectiveTraceId = traceId || randomUUID();

    // We process async and return 200 Fast (webhook style)
    processChatInline(message, effectiveTraceId).catch(err => {
        app.log.error(err, '❌ Async chat processing failed');
    });

    return reply.send({ status: 'processing', traceId: effectiveTraceId, agentId: AGENT_ID });
});


// ── LLM Core Execution (Transplanted from Orchestrator) ───────────────

async function processChatInline(userMessageText: string, traceId: string) {
    console.log(`🧠 [Agent Engine] Processing CHAT message for Agent ${AGENT_ID} (Model: ${MODEL_NAME})`);

    const agent = await prisma.agent.findUnique({
        where: { id: AGENT_ID },
        include: { tools: true }
    });

    if (!agent) {
        console.error(`❌ Agent ${AGENT_ID} not found in database. Cannot execute.`);
        return;
    }

    // Load Chat History
    const history = await prisma.message.findMany({
        where: { agentId: AGENT_ID },
        orderBy: { createdAt: 'asc' },
    });

    const googleChatHistory = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    // Add current message (we assume the caller already saved the User message to DB, but if not we should.)
    googleChatHistory.push({ role: 'user', parts: [{ text: userMessageText }] });

    // ── Define Tools ──────────────────────────────────────────────────
    const toolDeclarations: any[] = [];
    const availableTools = agent.tools;

    if (availableTools.some((t: any) => t.name === 'github_pr_review')) {
        toolDeclarations.push({
            name: 'github_pr_review',
            description: 'Trigger a GitHub PR Review logic. Returns a success string if executed.',
            parameters: {
                type: 'OBJECT',
                properties: { prNumber: { type: 'INTEGER' } },
                required: ['prNumber']
            }
        });
    }

    if (availableTools.some((t: any) => t.name === 'send_email')) {
        toolDeclarations.push({
            name: 'send_email',
            description: 'Require Human in the Loop (HITL) approval to send an email.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    to: { type: 'STRING' },
                    subject: { type: 'STRING' },
                    body: { type: 'STRING' },
                    rationale: { type: 'STRING' }
                },
                required: ['to', 'subject', 'body', 'rationale']
            }
        });
    }

    // ── Execute Gemini ──────────────────────────────────────────────────
    const t0 = Date.now();
    let apiCost = 0;
    let tokensUsed = 0;

    const reqConfig: any = {
        model: MODEL_NAME,
        contents: googleChatHistory,
        config: {
            systemInstruction: { parts: [{ text: agent.systemPrompt }] },
            temperature: 0.2,
        }
    };

    if (toolDeclarations.length > 0) {
        reqConfig.config.tools = [{ functionDeclarations: toolDeclarations }];
    }

    let response;
    try {
        console.log(`🤖 Calling Vertex AI for Agent ${agent.name}...`);

        // Ensure prompt logic is correct for genAI sdk
        const result = await genAI.models.generateContent({
            model: MODEL_NAME,
            contents: googleChatHistory,
            config: reqConfig.config
        });
        response = result;
    } catch (e: any) {
        console.error('❌ Vertex AI call failed:', e);
        await prisma.message.create({
            data: { agentId: AGENT_ID, role: 'assistant', content: `[System Error] LLM generation failed: ${e.message}` }
        });
        return;
    }

    // Parse Response properly
    let textResp = "[Empty Response]";
    let extractedCall = null;

    if (
        response.functionCalls &&
        response.functionCalls.length > 0 &&
        response.functionCalls[0]
    ) {
        extractedCall = response.functionCalls[0];
    } else {
        textResp = response.text() || "[Empty response]";
    }

    const t1 = Date.now();

    // Cost accounting (if provided, otherwise skip)
    // The exact properties here are sdk specific.

    // Usage tracking
    await prisma.usageLog.create({
        data: {
            agentId: AGENT_ID,
            action: 'llm_inference',
            tokens: tokensUsed,
            costUsd: apiCost,
            metadata: { durationMs: t1 - t0 }
        }
    });

    // Handle tool calls vs direct response
    if (extractedCall) {
        handleToolCall(extractedCall, agent, traceId, apiCost, tokensUsed);
    } else {
        await prisma.message.create({
            data: {
                agentId: AGENT_ID,
                role: 'assistant',
                content: textResp,
                tokens: tokensUsed,
                cost: apiCost
            }
        });
        console.log(`✅ Agent ${AGENT_ID} responded with text.`);
    }
}


function handleToolCall(call: any, agent: any, traceId: string, apiCost: number, tokensUsed: number) {
    const functionName = call.name;
    const args = call.args as Record<string, any>;

    console.log(`🛠️ Agent ${agent.name} called Tool: ${functionName}`);

    // HITL Tool Execution - Creates a Task
    if (functionName === 'send_email') {
        const payload = {
            recipient: args.to,
            subject: args.subject,
            body: args.body,
            rationale: args.rationale,
        };

        prisma.task.create({
            data: {
                description: `Agent requested to SEND AN EMAIL. Subject: "${args.subject}" to ${args.to}`,
                agentId: agent.id,
                inputPayload: payload,
                status: 'PENDING',
                traceId: traceId
            }
        }).then(task => {
            console.log(`⏳ HITL Task ${task.id} created for manual approval.`);
            prisma.message.create({
                data: {
                    agentId: agent.id,
                    role: 'assistant',
                    content: `[System] Created Task for manual approval: Send Em\ail to ${args.to}. Rationale: ${args.rationale}`,
                    tokens: tokensUsed,
                    cost: apiCost
                }
            });
        });
    } else if (functionName === 'github_pr_review') {
        // Auto-approved mock tool
        console.log(`🤖 Auto-executing GitHub PR Review for PR #${args.prNumber}`);
        prisma.message.create({
            data: {
                agentId: agent.id,
                role: 'assistant',
                content: `[System Tool Output] ✅ Successfully triggered GitHub PR Review pipeline for PR #${args.prNumber}. No errors reported.`,
                tokens: tokensUsed,
                cost: apiCost
            }
        });
    }
}

// ── Start ────────────────────────────────────────────────────────────

async function start() {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`🚀 Isolated Agent Engine (${AGENT_ID}) listening on http://0.0.0.0:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

start();
