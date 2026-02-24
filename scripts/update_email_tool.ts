import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('📡 Updating send_email tool in database...');

    const configSchema = {
        parameters: {
            type: 'OBJECT',
            properties: {
                to: { type: 'STRING', description: 'Recipient email address' },
                subject: { type: 'STRING', description: 'Email subject line' },
                body: { type: 'STRING', description: 'Email body text' }
            },
            required: ['to', 'subject', 'body']
        }
    };

    try {
        const updated = await prisma.tool.update({
            where: { name: 'send_email' },
            data: {
                description: 'Send an email. Required parameters: to (email address), subject (email subject), body (email body text).',
                configuration: configSchema
            }
        });
        console.log('✅ Successfully updated send_email tool:', updated.name);
    } catch (e: any) {
        if (e.code === 'P2025') {
            console.log('⚠️ Tool send_email not found in database.');
        } else {
            console.error('❌ Error updating tool:', e);
        }
    }
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
