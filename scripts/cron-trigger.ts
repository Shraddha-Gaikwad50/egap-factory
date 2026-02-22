#!/usr/bin/env ts-node

/**
 * EGAP Cron Trigger Script
 * 
 * Sends a scheduled message to an agent via the /api/chat endpoint.
 * Can be wired into macOS crontab, Google Cloud Scheduler, or run manually.
 * 
 * Usage:
 *   npx ts-node scripts/cron-trigger.ts --agentId <uuid> --message "Daily summary please"
 *   npx ts-node scripts/cron-trigger.ts --agentId <uuid>  (uses default message)
 * 
 * Environment:
 *   ORCHESTRATOR_URL  — Base URL of the orchestrator (default: http://localhost:8080)
 * 
 * Crontab example (runs every day at 8 AM):
 *   0 8 * * * cd /path/to/egap-factory && npx ts-node scripts/cron-trigger.ts --agentId <uuid> --message "Morning briefing"
 */

import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080';

// ── Parse CLI Arguments ──────────────────────────────────────────────
function parseArgs(): { agentId: string; message: string } {
    const args = process.argv.slice(2);
    let agentId = '';
    let message = 'This is a scheduled automated check-in. Please provide a status summary.';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--agentId' && args[i + 1]) {
            agentId = args[++i];
        } else if (args[i] === '--message' && args[i + 1]) {
            message = args[++i];
        }
    }

    if (!agentId) {
        console.error('❌ Usage: npx ts-node scripts/cron-trigger.ts --agentId <uuid> [--message "your message"]');
        process.exit(1);
    }

    return { agentId, message };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
    const { agentId, message } = parseArgs();
    const url = `${ORCHESTRATOR_URL}/api/chat`;

    console.log(`⏰ EGAP Cron Trigger`);
    console.log(`   Target Agent : ${agentId}`);
    console.log(`   Message      : ${message}`);
    console.log(`   Endpoint     : ${url}`);
    console.log(`   Time         : ${new Date().toISOString()}`);
    console.log('');

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, message }),
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`✅ Message sent successfully!`);
            console.log(`   Status   : ${(data as any).status}`);
            console.log(`   Trace ID : ${(data as any).messageId || 'N/A'}`);
        } else {
            console.error(`❌ Failed to send message (HTTP ${response.status}):`);
            console.error(`   ${JSON.stringify(data)}`);
            process.exit(1);
        }
    } catch (err: any) {
        console.error(`❌ Connection error: ${err.message}`);
        console.error(`   Is the orchestrator running at ${ORCHESTRATOR_URL}?`);
        process.exit(1);
    }
}

main();
