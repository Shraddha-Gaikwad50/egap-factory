const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const d = await prisma.deployment.findMany({
    where: { agent: { name: 'Story teller' } },
    orderBy: { createdAt: 'desc' },
    include: { agent: true }
  });
  console.log(JSON.stringify(d, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
