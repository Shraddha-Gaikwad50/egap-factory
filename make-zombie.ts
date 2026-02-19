
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const task = await prisma.task.findFirst();
    if (task) {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        await prisma.task.update({
            where: { id: task.id },
            data: { updatedAt: fifteenMinutesAgo }
        });
        console.log(`✅ Backdated Task ${task.id} to ${fifteenMinutesAgo.toISOString()}`);
    } else {
        console.log('❌ No task found to update');
    }
}

main().finally(() => prisma.$disconnect());
