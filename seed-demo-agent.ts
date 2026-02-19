import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const agent = await prisma.agent.upsert({
        where: { name: 'GitHub Ops Agent' },
        update: {},
        create: {
            name: 'GitHub Ops Agent',
            role: 'github',
            goal: 'Automate PR reviews and CI checks',
            systemPrompt: 'You are a DevOps expert.',
        },
    });
    console.log(`✅ Upserted agent: ${agent.name} (ID: ${agent.id})`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
