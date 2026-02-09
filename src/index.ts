import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

// POST /api/agents - Create a new agent
app.post('/api/agents', async (req, res) => {
    try {
        const { name, role, goal, systemPrompt, tools } = req.body;

        const agent = await prisma.agent.create({
            data: {
                name,
                role,
                goal,
                systemPrompt,
                tools: {
                    connect: tools.map((id: string) => ({ id }))
                }
            },
            include: {
                tools: true
            }
        });

        console.log(`Created agent: ${agent.name}`);
        res.status(201).json(agent);
    } catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ error: 'Failed to create agent' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Factory API running on http://localhost:${PORT}`);
});
