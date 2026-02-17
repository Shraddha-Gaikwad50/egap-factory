import { PubSub, Message } from '@google-cloud/pubsub';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

// ── Config ───────────────────────────────────────────────────────────
dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID;
const SUBSCRIPTION_NAME = process.env.SUBSCRIPTION_NAME;

if (!PROJECT_ID || !SUBSCRIPTION_NAME) {
    console.error(
        '❌ Missing required env vars: PROJECT_ID and SUBSCRIPTION_NAME must be set in .env',
    );
    process.exit(1);
}

// ── Clients ──────────────────────────────────────────────────────────
const pubsub = new PubSub({ projectId: PROJECT_ID });
const subscription = pubsub.subscription(SUBSCRIPTION_NAME);
const prisma = new PrismaClient();

// ── Message Handler ──────────────────────────────────────────────────
async function handleMessage(message: Message): Promise<void> {
    const rootStart = Date.now();
    let traceId = '';
    let rootSpanId = randomUUID();

    try {
        // 1. Log incoming message ID & parse the data
        const data = JSON.parse(message.data.toString());
        console.log(`📩 Received message ${message.id}`);
        console.log('   Data:', JSON.stringify(data, null, 2));

        // 2. Trace Injection (Week 8)
        //    Use existing traceId from the message attributes/data, or generate a new one
        traceId =
            message.attributes?.traceId || data.traceId || randomUUID();

        if (message.attributes?.traceId || data.traceId) {
            console.log(`🔗 Trace ID (inherited): ${traceId}`);
        } else {
            console.log(`🆕 Trace ID (generated): ${traceId}`);
        }

        // FRS: Record root span for message processing
        await prisma.traceSpan.create({
            data: {
                id: rootSpanId,
                traceId,
                service: 'orchestrator',
                operation: 'process_message',
                metadata: { messageId: message.id },
            },
        });

        // 2b. Handle RESUME signals from the HITL approval flow
        if (data.type === 'RESUME') {
            console.log(`🚀 RESUMING AGENT for Task ${data.taskId}! Executing tool call...`);

            // Fetch the full agent to get knowledgeBaseId
            const agent = await prisma.agent.findUnique({
                where: { id: data.agentId },
                include: { tools: true } // Assuming tools are needed, but for now just KB ID
            });

            if (!agent) {
                console.error(`❌ Agent ${data.agentId} not found during RESUME`);
                message.ack();
                return;
            }

            // Construct Tool Arguments
            // The payload from the task (which came from Ingress) is likely the tool arguments
            // We need to know WHICH tool to call. 
            // Assumption: The message data contains the tool name or the task description implies it.
            // For this implementation, we'll assume a default tool 'search_vertex_docs' or extract from payload if structured.
            // But the prompt says "the tool is search_vertex", implying we might be hardcoding this behavior for the demo 
            // or the `data` object has a `tool` field.
            // Let's assume `data.tool` exists or default to `search_vertex_docs` for this specific flow.

            const toolName = data.tool || 'search_vertex_docs';
            let toolArgs = data.payload || {};

            // INJECTION LOGIC
            if (agent.knowledgeBaseId && toolName === 'search_vertex_docs') {
                console.log(`💉 Injecting Knowledge Base ID: ${agent.knowledgeBaseId}`);
                toolArgs = { ...toolArgs, data_store_id: agent.knowledgeBaseId };
            }

            // JSON-RPC Payload for MCP Hub
            const jsonRpcPayload = {
                jsonrpc: "2.0",
                method: "call_tool",
                params: {
                    name: toolName,
                    arguments: toolArgs
                },
                id: randomUUID()
            };

            console.log('📤 Sending JSON-RPC to MCP Hub:', JSON.stringify(jsonRpcPayload, null, 2));

            try {
                // Call MCP Hub (assuming running on port 8000 based on standard Python usage)
                // In a real K8s setup, this would be `http://egap-mcp-hub:8000/mcp`
                const response = await fetch('http://localhost:8000/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(jsonRpcPayload)
                });

                const result = await response.json();
                console.log('📥 MCP Hub Response:', JSON.stringify(result, null, 2));

                // FRS: Cost Accounting — log token usage for the resume action and tool call
                await prisma.usageLog.create({
                    data: {
                        agentId: data.agentId,
                        action: 'tool_execution', // Changed from 'resume' to reflect actual execution
                        tokens: 150, // Higher cost for actual execution
                        costUsd: 0.0015,
                        metadata: { taskId: data.taskId, traceId, tool: toolName, kbId: agent.knowledgeBaseId },
                    },
                });
                console.log(`💰 Logged 150 tokens for agent ${data.agentId} (tool_execution)`);

            } catch (error) {
                console.error('❌ Failed to call MCP Hub:', error);
            }

            // FRS: Record resume span
            await prisma.traceSpan.create({
                data: {
                    traceId,
                    parentId: rootSpanId,
                    service: 'orchestrator',
                    operation: 'resume_agent',
                    durationMs: Date.now() - rootStart,
                    metadata: { taskId: data.taskId },
                },
            });

            // Update root span duration
            await prisma.traceSpan.update({
                where: { id: rootSpanId },
                data: { durationMs: Date.now() - rootStart },
            });

            message.ack();
            console.log(`✅ Message ${message.id} acknowledged.\n`);
            return;
        }

        // 3. Agent Lookup — match the message source to an Agent role
        const agentLookupStart = Date.now();
        const source: string = data.source || 'unknown';
        const agent = await prisma.agent.findFirst({
            where: { role: source, status: 'LIVE' },
        });

        // FRS: Record agent_lookup span
        await prisma.traceSpan.create({
            data: {
                traceId,
                parentId: rootSpanId,
                service: 'orchestrator',
                operation: 'agent_lookup',
                durationMs: Date.now() - agentLookupStart,
                metadata: { source, found: !!agent },
            },
        });

        if (agent) {
            console.log(`🎯 Found Agent: ${agent.name} (ID: ${agent.id})`);

            // 4. Create a Task for HITL governance — awaits human approval
            const taskCreateStart = Date.now();
            const task = await prisma.task.create({
                data: {
                    description: `Signal from ${source}: ${JSON.stringify(data.payload ?? data)}`,
                    inputPayload: data,
                    agentId: agent.id,
                },
            });
            console.log(`📝 Created Task ${task.id} - Waiting for Approval`);

            // FRS: Record task_create span
            await prisma.traceSpan.create({
                data: {
                    traceId,
                    parentId: rootSpanId,
                    service: 'orchestrator',
                    operation: 'task_create',
                    durationMs: Date.now() - taskCreateStart,
                    metadata: { taskId: task.id, agentName: agent.name },
                },
            });

            // FRS: Cost Accounting — log token usage for the tool call
            await prisma.usageLog.create({
                data: {
                    agentId: agent.id,
                    action: 'tool_call',
                    tokens: 120,
                    costUsd: 0.0012,
                    metadata: { taskId: task.id, source, traceId },
                },
            });
            console.log(`💰 Logged 120 tokens for agent ${agent.name} (tool_call)`);
        } else {
            console.log(`⚠️ No agent found for source: ${source}`);
        }

        // Update root span duration
        await prisma.traceSpan.update({
            where: { id: rootSpanId },
            data: { durationMs: Date.now() - rootStart },
        });

        // 5. Acknowledge the message so it is not redelivered
        message.ack();
        console.log(`✅ Message ${message.id} acknowledged.\n`);
    } catch (err) {
        console.error(`⚠️  Error processing message ${message.id}:`, err);
        // Record error span
        if (traceId) {
            await prisma.traceSpan.update({
                where: { id: rootSpanId },
                data: { status: 'ERROR', durationMs: Date.now() - rootStart },
            }).catch(() => { });
        }
        // Still acknowledge to prevent infinite redelivery of a bad message.
        // In production you might nack() or send to a dead-letter topic instead.
        message.ack();
    }
}

// ── Error Handler ────────────────────────────────────────────────────
subscription.on('error', (err: Error) => {
    console.error('🚨 Subscription error (not crashing):', err.message);
});

// ── Start Listening ──────────────────────────────────────────────────
subscription.on('message', handleMessage);

console.log('──────────────────────────────────────────────');
console.log('🚀 EGAP Orchestrator Worker is running');
console.log(`   PROJECT_ID        : ${PROJECT_ID}`);
console.log(`   SUBSCRIPTION_NAME : ${SUBSCRIPTION_NAME}`);
console.log('   Listening for messages…');
console.log('──────────────────────────────────────────────');
