
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Ensure agent exists
    let agent = await prisma.agent.findFirst();
    if (!agent) {
        agent = await prisma.agent.create({
            data: {
                name: 'SafetyBot',
                role: 'Guardian',
                goal: 'Ensure safety',
                systemPrompt: 'You are safe.',
            }
        });
    }

    // Create a PENDING task
    const task = await prisma.task.create({
        data: {
            description: 'Execute high-risk database migration',
            status: 'PENDING',
            agentId: agent.id,
            inputPayload: { sql: 'DROP TABLE users;' }
        }
    });

    console.log(`✅ Created PENDING Task: ${task.id}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
