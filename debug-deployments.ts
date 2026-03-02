import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const deps = await prisma.deployment.findMany({
    orderBy: { deployedAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(deps, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
