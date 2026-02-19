
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

async function verify() {
    console.log('🚀 Starting Phase 3 Verification...');

    // 1. Create Agent
    console.log('\n--- Step 1: Creating Agent ---');
    const agentData = {
        name: `Test Agent ${Date.now()}`,
        role: "Test Assistant",
        goal: "Verify the system works end-to-end",
        systemPrompt: "You are a helpful assistant. Reply with 'Verification Successful'.",
        tools: []
    };

    let agentId;
    try {
        const res = await fetch(`${BASE_URL}/api/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(agentData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        agentId = data.id;
        console.log(`✅ Agent Created: ${data.name} (ID: ${agentId})`);
    } catch (err) {
        console.error('❌ Failed to create agent:', err);
        process.exit(1);
    }

    // 2. Send Chat Message
    console.log('\n--- Step 2: Sending Chat Message ---');
    try {
        const res = await fetch(`${BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                message: "Hello, system!"
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        console.log(`✅ Message Sent. ID: ${data.messageId}`);
    } catch (err) {
        console.error('❌ Failed to send message:', err);
        process.exit(1);
    }

    // 3. Poll for Response
    console.log('\n--- Step 3: Polling for Response (Brain) ---');
    let attempts = 0;
    const maxAttempts = 10;

    const interval = setInterval(async () => {
        attempts++;
        process.stdout.write('.');

        try {
            const res = await fetch(`${BASE_URL}/api/agents/${agentId}/messages`);
            const messages = await res.json();

            // Find assistant response
            const response = messages.find((m: any) => m.role === 'assistant');

            if (response) {
                console.log('\n✅ Response Received!');
                console.log(`🤖 Agent said: "${response.content}"`);
                clearInterval(interval);
                process.exit(0);
            }

            if (attempts >= maxAttempts) {
                console.log('\n❌ Timed out waiting for response.');
                console.log('Current history:', JSON.stringify(messages, null, 2));
                process.exit(1);
            }
        } catch (err) {
            console.error('\n❌ Error polling:', err);
        }
    }, 2000);
}

verify();
