import { PrismaClient } from '@prisma/client';
import { CloudBuildClient } from '@google-cloud/cloudbuild';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const cbClient = new CloudBuildClient();

const LOCATION = process.env.LOCATION || 'us-central1';
const PROJECT_ID = process.env.PROJECT_ID || 'gls-training-486405';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

async function main() {
    const agents = await prisma.agent.findMany();
    console.log(`Found ${agents.length} agents. Location: ${LOCATION}, Project: ${PROJECT_ID}`);

    for (const agent of agents) {
        const slug = agent.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        console.log(`🚀 Triggering Cloud Build for Agent: ${agent.name} (Slug: ${slug})`);

        // Check if there is already a deployment, if so, skip or deploy over?
        // We will deploy over it to ensure everyone has an isolated container.

        const buildRequest = {
            projectId: PROJECT_ID,
            build: {
                steps: [
                    {
                        name: 'gcr.io/cloud-builders/docker',
                        args: ['build', '-t', `gcr.io/${PROJECT_ID}/agent-engine-${slug}`, '-f', 'services/agent-engine/Dockerfile', '.'],
                    },
                    {
                        name: 'gcr.io/cloud-builders/docker',
                        args: ['push', `gcr.io/${PROJECT_ID}/agent-engine-${slug}`],
                    },
                    {
                        name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
                        entrypoint: 'gcloud',
                        args: [
                            'run', 'deploy', `agent-${slug}`,
                            '--image', `gcr.io/${PROJECT_ID}/agent-engine-${slug}`,
                            '--region', LOCATION,
                            '--platform', 'managed',
                            '--allow-unauthenticated',
                            '--set-env-vars', `AGENT_ID=${agent.id},PROJECT_ID=${PROJECT_ID},GMAIL_USER=${GMAIL_USER},GMAIL_APP_PASSWORD=${GMAIL_APP_PASSWORD}`
                        ],
                    }
                ],
            }
        };

        try {
            // @ts-ignore
            const [operation] = await cbClient.createBuild(buildRequest);
            console.log(`☁️ Cloud Build started for ${slug}. Operation Name: ${operation.name}`);

            await prisma.deployment.create({
                data: {
                    agentId: agent.id,
                    status: 'DEPLOYING',
                    serviceUrl: `agent-${slug}-910005263485.${LOCATION}.run.app`
                }
            });
        } catch (e: any) {
            console.error(`❌ Failed to start Cloud Build for ${slug}:`, e.message || e);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
