import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT) || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));

// Health check - returns 200 immediately, no DB dependency
app.get('/', (req, res) => {
    res.send('Health Check OK');
});

// GET /api/tools - Return all available tools from the database
app.get('/api/tools', async (req, res) => {
    try {
        const tools = await prisma.tool.findMany();
        res.json(tools);
    } catch (error) {
        console.error('Error fetching tools:', error);
        res.status(500).json({ error: 'Failed to fetch tools' });
    }
});

// GET /api/tools/available - Dynamic discovery from MCP Hub with fallback
app.get('/api/tools/available', async (req, res) => {
    // Default fallback tools if MCP Hub is offline
    const fallbackTools = [
        { id: 'search', name: 'search', description: 'Google Search (Fallback)' },
        { id: 'email', name: 'email', description: 'Send Emails (Fallback)' },
        { id: 'github', name: 'github', description: 'GitHub Integration (Fallback)' }
    ];

    try {
        // Try to fetch from MCP Hub
        // Assuming MCP Hub runs on port 8000 by default or via env var
        const mcpHubUrl = process.env.MCP_HUB_URL || 'http://localhost:8000';

        // Using JSON-RPC 2.0 format as per previous context
        const response = await fetch(`${mcpHubUrl}/jsonrpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'list_tools',
                id: 1,
                params: {}
            })
        });

        if (!response.ok) {
            throw new Error(`MCP Hub returned ${response.status}`);
        }

        const data = await response.json() as { result: Array<{ name: string; description: string }> };

        if (data.result && Array.isArray(data.result)) {
            // Map MCP tools to our format
            // We use the name as ID since MCP doesn't strictly provide IDs in list_tools
            const tools = data.result.map(t => ({
                id: t.name,
                name: t.name,
                description: t.description || 'No description provided'
            }));
            return res.json(tools);
        }

        // If format is unexpected, throw to trigger fallback
        throw new Error('Invalid response format from MCP Hub');

    } catch (error: any) {
        console.warn(`⚠️ MCP Hub unavailable (${error.message}). Using fallback tools.`);
        // Return fallback list so the UI never breaks
        res.json(fallbackTools);
    }
});

// GET /api/agents - List agents (optionally filtered by workspace)
app.get('/api/agents', async (req, res) => {
    try {
        const { workspace } = req.query;
        const where = workspace ? { workspace: String(workspace) } : {};

        const agents = await prisma.agent.findMany({
            where,
            include: { tools: true }
        });
        res.json(agents);
    } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ error: 'Failed to fetch agents' });
    }
});

// POST /api/agents - Create a new agent
app.post('/api/agents', async (req, res) => {
    try {
        const { name, role, goal, systemPrompt, tools, workspace, status } = req.body;
        console.log('DEBUG: POST /api/agents BODY:', JSON.stringify(req.body)); // <--- DEBUG LOG

        const agent = await prisma.agent.create({
            data: {
                name,
                role,
                goal,
                systemPrompt,
                workspace: workspace || 'General',
                status: status || 'LIVE', // <--- Added
                tools: {
                    connect: tools.map((id: string) => ({ id }))
                }
            },
            include: {
                tools: true
            }
        });

        console.log(`Created agent: ${agent.name} in workspace: ${agent.workspace} (Status: ${agent.status})`);
        res.status(201).json(agent);
    } catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ error: 'Failed to create agent' });
    }
});

// PUT /api/agents/:id - Update agent and track prompt history
app.put('/api/agents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, goal, systemPrompt, tools, workspace, status } = req.body;

        // 1. Fetch current agent to check for prompt changes
        const currentAgent = await prisma.agent.findUnique({
            where: { id },
            include: { history: true }
        });

        if (!currentAgent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        // 2. If prompt changed, save the OLD prompt to history
        if (currentAgent.systemPrompt !== systemPrompt) {
            const nextVersion = (currentAgent.history?.length || 0) + 1;

            await prisma.promptHistory.create({
                data: {
                    agentId: id,
                    prompt: currentAgent.systemPrompt,
                    version: nextVersion,
                    createdAt: new Date() // Explicitly set creation time
                }
            });
            console.log(`📜 Saved prompt history v${nextVersion} for agent ${currentAgent.name}`);
        }

        // 3. Update the agent
        const updatedAgent = await prisma.agent.update({
            where: { id },
            data: {
                name,
                role,
                goal,
                systemPrompt,
                workspace: workspace || currentAgent.workspace,
                status: status || currentAgent.status,
                tools: {
                    set: [], // Clear existing tools
                    connect: tools.map((toolId: string) => ({ id: toolId }))
                }
            },
            include: {
                tools: true,
                history: {
                    orderBy: { version: 'desc' }
                }
            }
        });

        console.log(`Updated agent: ${updatedAgent.name}`);
        res.json(updatedAgent);
    } catch (error) {
        console.error('Error updating agent:', error);
        res.status(500).json({ error: 'Failed to update agent' });
    }
});

// GET /.well-known/agent.json — FRS Agent Card for runtime discovery
app.get('/.well-known/agent.json', async (req, res) => {
    try {
        // Filter out DRAFT agents — ACC should only see LIVE agents
        const agents = await prisma.agent.findMany({
            where: { status: 'LIVE' },
            include: { tools: true }
        });

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
                workspace: a.workspace, // <--- Added
                status: a.status,       // <--- Added
                tools: a.tools.map(t => t.name),
            })),
        });
    } catch (error) {
        console.error('Error building agent card:', error);
        res.status(500).json({ error: 'Failed to build agent card' });
    }
});

// POST /api/deploy — Trigger Cloud Build to deploy the factory to Cloud Run
app.post('/api/deploy', async (req, res) => {
    try {
        const { exec } = await import('child_process');
        const projectId = process.env.PROJECT_ID || 'gls-training-486405';

        console.log('🚀 Triggering Cloud Build deployment...');

        exec(
            `gcloud builds submit --config cloudbuild.yaml --project ${projectId} .`,
            { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 10 },
            (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Cloud Build failed:', error.message);
                    // Don't send response here — it was already sent
                    return;
                }
                console.log('✅ Cloud Build completed:', stdout);
            }
        );

        // Return immediately — build runs in background
        res.status(202).json({
            status: 'BUILDING',
            message: 'Cloud Build triggered. Deployment in progress.',
            project: projectId,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error triggering deploy:', error);
        res.status(500).json({ error: 'Failed to trigger deployment' });
    }
});

// Catch-all route - serve React app for any unknown requests (React Router support)
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Background database connection - non-blocking
async function startDatabase() {
    try {
        await prisma.$connect();
        console.log('✅ Database connected successfully');
    } catch (err) {
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
