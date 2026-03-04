
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// MCP Hub URL — update this to your deployed Cloud Run URL in production
const MCP_HUB_URL = process.env.MCP_HUB_URL || 'http://localhost:8080';

async function main() {
    console.log('🌱 Seeding Tools (MCP-compliant)...');

    const tools = [
        {
            name: 'search_vertex_docs',
            description: 'Search Google Cloud Vertex AI documentation',
            configuration: {},
            mcpServerUrl: `${MCP_HUB_URL}/mcp`,
            actionType: 'READ',
        },
        {
            name: 'send_email',
            description: 'Send an email to a recipient. Requires HITL approval.',
            configuration: {},
            mcpServerUrl: `${MCP_HUB_URL}/mcp`,
            actionType: 'WRITE',
        },
        {
            name: 'save_file',
            description: 'Save a file to Cloud Storage. Requires HITL approval.',
            configuration: {},
            mcpServerUrl: `${MCP_HUB_URL}/mcp`,
            actionType: 'WRITE',
        },
        {
            name: 'google_search',
            description: 'Search the web using Google Search',
            configuration: {},
            mcpServerUrl: null,
            actionType: 'READ',
        },
        {
            name: 'github_integration',
            description: 'Interact with GitHub repositories',
            configuration: {},
            mcpServerUrl: null,
            actionType: 'READ',
        }
    ];

    for (const tool of tools) {
        const existing = await prisma.tool.findUnique({ where: { name: tool.name } });
        if (!existing) {
            await prisma.tool.create({ data: tool });
            console.log(`✅ Created tool: ${tool.name} (actionType: ${tool.actionType})`);
        } else {
            // Update existing tools with new MCP fields
            await prisma.tool.update({
                where: { name: tool.name },
                data: {
                    mcpServerUrl: tool.mcpServerUrl,
                    actionType: tool.actionType,
                    description: tool.description,
                },
            });
            console.log(`🔄 Updated tool: ${tool.name} (actionType: ${tool.actionType}, mcpServerUrl: ${tool.mcpServerUrl || 'none'})`);
        }
    }

    console.log('✅ Tools seeded with MCP metadata.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
