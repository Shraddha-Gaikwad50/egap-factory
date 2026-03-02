import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { deployments: true }
  });
  console.log(JSON.stringify(agents, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
