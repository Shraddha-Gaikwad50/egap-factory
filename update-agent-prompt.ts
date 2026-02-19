
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const agentId = '1c3faf1a-6cc7-4291-8c77-cb3212fdf7ba';
    await prisma.agent.update({
        where: { id: agentId },
        data: {
            systemPrompt: "You are a helpful assistant. You have access to a 'send_email' tool. ALWAYS use this tool when asked to send an email. Do not refuse."
        }
    });
    console.log(`✅ Updated System Prompt for Agent ${agentId}`);
}

main().finally(() => prisma.$disconnect());
