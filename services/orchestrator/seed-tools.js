import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://postgres:aditya%4012345@127.0.0.1:5434/postgres"
        }
    }
});

const tools = [
    {
        name: "search_vertex_docs",
        description: "Search the Vertex AI documentation for technical information.",
        configuration: {
            parameters: {
                type: "OBJECT",
                properties: {
                    query: { type: "STRING", description: "The search query." }
                },
                required: ["query"]
            }
        }
    },
    {
        name: "save_file",
        description: "Save a text file to Google Cloud Storage.",
        configuration: {
            parameters: {
                type: "OBJECT",
                properties: {
                    filename: { type: "STRING", description: "Name of the file to save (e.g., report.txt)." },
                    content: { type: "STRING", description: "The text content to save." }
                },
                required: ["filename", "content"]
            }
        }
    },
    {
        name: "send_email",
        description: "Send an email to a recipient. REQUIRES HUMAN APPROVAL.",
        configuration: {
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
    }
];

async function main() {
    console.log("Seeding base tools with JSON schemas...");
    for (const tool of tools) {
        await prisma.tool.upsert({
            where: { name: tool.name },
            update: {
                description: tool.description,
                configuration: tool.configuration
            },
            create: {
                name: tool.name,
                description: tool.description,
                configuration: tool.configuration
            }
        });
        console.log(`✅ Upserted tool: ${tool.name}`);
    }
    console.log("Done.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
