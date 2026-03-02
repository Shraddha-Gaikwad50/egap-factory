"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const pubsub_1 = require("@google-cloud/pubsub");
const crypto_1 = require("crypto");
const validation_1 = require("./validation");
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const pubsub = new pubsub_1.PubSub({ projectId: process.env.PROJECT_ID });
const TOPIC_NAME = process.env.TOPIC_NAME || 'egap-ingress-topic';
const PORT = Number(process.env.PORT) || 8080;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Serve static files from the React app
app.use(express_1.default.static(path_1.default.join(__dirname, '../client/dist')));
// Health check - returns 200 immediately, no DB dependency
app.get('/', (req, res) => {
    res.send('Health Check OK');
});
// GET /api/tools - Return all available tools from the database
app.get('/api/tools', async (req, res) => {
    try {
        const tools = await prisma.tool.findMany();
        res.json(tools);
    }
    catch (error) {
        console.error('Error fetching tools:', error);
        res.status(500).json({ error: 'Failed to fetch tools' });
    }
});
// POST /api/agents - Create a new agent
app.post('/api/agents', async (req, res) => {
    try {
        // Validate input
        const validationResult = validation_1.AgentSchema.safeParse(req.body);
        if (!validationResult.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validationResult.error.format()
            });
        }
        const { name, role, goal, systemPrompt, tools } = validationResult.data;
        const agent = await prisma.agent.create({
            data: {
                name,
                role,
                goal,
                systemPrompt,
                tools: {
                    connect: tools.map((id) => ({ id }))
                }
            },
            include: {
                tools: true
            }
        });
        console.log(`Created agent: ${agent.name}`);
        res.status(201).json(agent);
    }
    catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ error: 'Failed to create agent' });
    }
});
// GET /.well-known/agent.json — FRS Agent Card for runtime discovery
app.get('/.well-known/agent.json', async (req, res) => {
    try {
        const agents = await prisma.agent.findMany({ include: { tools: true } });
        res.json({
            name: 'EGAP Factory',
            version: '0.1.0',
            description: 'Enterprise-Grade Agentic Platform — Agent Building Service',
            capabilities: ['agent-creation', 'tool-management', 'deployment'],
            agents: agents.map(a => ({
                id: a.id,
                name: a.name,
                role: a.role,
                goal: a.goal,
                tools: a.tools.map(t => t.name),
            })),
        });
    }
    catch (error) {
        console.error('Error building agent card:', error);
        res.status(500).json({ error: 'Failed to build agent card' });
    }
});
// ─── Chat Endpoints ──────────────────────────────────────────────────
// Send a message to an agent
app.post('/api/chat', async (req, res) => {
    try {
        const { agentId, message } = req.body;
        if (!agentId || !message) {
            res.status(400).json({ error: 'agentId and message are required' });
            return;
        }
        // 1. Save User Message
        const userMsg = await prisma.message.create({
            data: {
                agentId,
                role: 'user',
                content: message,
            },
        });
        // 2. Publish to Pub/Sub for the Brain
        const topic = pubsub.topic(TOPIC_NAME);
        const payload = {
            type: 'CHAT',
            agentId,
            message,
            traceId: (0, crypto_1.randomUUID)(), // Start a new trace
        };
        await topic.publishMessage({
            data: Buffer.from(JSON.stringify(payload)),
            attributes: {
                source: 'api',
                traceId: payload.traceId,
            },
        });
        console.log(`📨 Sent CHAT signal for Agent ${agentId} to topic ${TOPIC_NAME}`);
        res.json({ status: 'queued', messageId: userMsg.id });
    }
    catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});
// Get chat history for an agent
app.get('/api/agents/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const messages = await prisma.message.findMany({
            where: { agentId: id },
            orderBy: { createdAt: 'asc' }, // Oldest first for chat UI
        });
        res.json(messages);
    }
    catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});
// POST /api/system/update — Trigger Cloud Build to update the Factory Worker Pool
// Note: In the "Shared Runtime" model, we update the entire platform at once,
// rather than deploying individual services for each agent.
app.post('/api/system/update', async (req, res) => {
    try {
        const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const projectId = process.env.PROJECT_ID || 'gls-training-486405';
        console.log('🚀 Triggering Cloud Build deployment...');
        exec(`gcloud builds submit --config cloudbuild.yaml --project ${projectId} .`, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Cloud Build failed:', error.message);
                // Don't send response here — it was already sent
                return;
            }
            console.log('✅ Cloud Build completed:', stdout);
        });
        // Return immediately — build runs in background
        res.status(202).json({
            status: 'BUILDING',
            message: 'Cloud Build triggered. Deployment in progress.',
            project: projectId,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('Error triggering deploy:', error);
        res.status(500).json({ error: 'Failed to trigger deployment' });
    }
});
// Catch-all route - serve React app for any unknown requests (React Router support)
app.get(/.*/, (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../client/dist/index.html'));
});
// Background database connection - non-blocking
async function startDatabase() {
    try {
        await prisma.$connect();
        console.log('✅ Database connected successfully');
    }
    catch (err) {
        console.error('⚠️ Database connection failed:', err);
        console.log('Server is running but database is unavailable. Retrying is handled by Prisma on next query.');
    }
}
// Start server IMMEDIATELY - Cloud Run health checks pass right away
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Factory API running on http://0.0.0.0:${PORT}`);
    // Connect to database in the background AFTER server is listening
    startDatabase();
});
//# sourceMappingURL=index.js.map