import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const agent = await prisma.agent.findFirst({
        where: { name: { contains: 'GlobalTech' } },
        include: { tools: true }
    });
    if (!agent) {
        console.log('Agent not found');
        return;
    }
    const payload = {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        goal: agent.goal,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools.map(t => t.name)
    };
    console.log(JSON.stringify(payload));
}
main().catch(console.error).finally(() => prisma.$disconnect());
