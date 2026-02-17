import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // Find the agent with the incorrect role string
    const agent = await prisma.agent.findFirst({
        where: {
            role: { contains: 'slack (Crucial' }
        }
    });

    if (agent) {
        console.log(`Found agent with incorrect role: ${agent.name} (${agent.role})`);
        const updated = await prisma.agent.update({
            where: { id: agent.id },
            data: { role: 'slack' }
        });
        console.log(`✅ Corrected role to: ${updated.role}`);
    } else {
        console.log('⚠️  No agent found with incorrect role string.');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
