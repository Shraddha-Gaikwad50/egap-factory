
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Keys on prisma client:', Object.keys(prisma));
    // @ts-ignore
    if (prisma.globalSettings) {
        console.log('✅ prisma.globalSettings is defined');
    } else {
        console.error('❌ prisma.globalSettings is UNDEFINED');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
