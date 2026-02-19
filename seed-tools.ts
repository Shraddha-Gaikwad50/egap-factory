
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding Tools...');

    const tools = [
        {
            name: 'search_vertex_docs',
            description: 'Search Google Cloud Vertex AI documentation',
            configuration: {}
        },
        {
            name: 'send_email',
            description: 'Send an email to a recipient',
            configuration: {}
        },
        {
            name: 'save_file',
            description: 'Save a file to Cloud Storage',
            configuration: {}
        },
        {
            name: 'google_search',
            description: 'Search the web using Google Search',
            configuration: {}
        },
        {
            name: 'github_integration',
            description: 'Interact with GitHub repositories',
            configuration: {}
        }
    ];

    for (const tool of tools) {
        const existing = await prisma.tool.findUnique({ where: { name: tool.name } });
        if (!existing) {
            await prisma.tool.create({ data: tool });
            console.log(`✅ Created tool: ${tool.name}`);
        } else {
            console.log(`⏩ Tool already exists: ${tool.name}`);
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
