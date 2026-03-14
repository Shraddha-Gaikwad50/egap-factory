const { ReasoningEngineExecutionServiceClient } = require('@google-cloud/aiplatform');
const client = new ReasoningEngineExecutionServiceClient({ apiEndpoint: 'us-central1-aiplatform.googleapis.com' });

async function run() {
    try {
        const responseStream = await client.streamQueryReasoningEngine({
            name: 'projects/910005263485/locations/us-central1/reasoningEngines/2940620758742728704',
            classMethod: 'stream_query',
            input: {
                fields: {
                    user_id: { stringValue: 'test-user-123' },
                    message: { stringValue: 'Send an email to test@example.com with subject hello and body world' }
                }
            }
        });
        
        let chunkIndex = 0;
        for await (const chunk of responseStream) {
            console.log(`\n=== CHUNK ${chunkIndex++} ===`);
            console.log("Keys:", Object.keys(chunk));
            console.log("contentType:", chunk.contentType);
            
            // Deep inspect chunk.data
            const d = chunk.data;
            console.log("typeof chunk.data:", typeof d);
            if (d !== null && d !== undefined) {
                if (Buffer.isBuffer(d)) {
                    console.log("chunk.data IS a Buffer, decoded:", d.toString('utf-8'));
                } else if (typeof d === 'object') {
                    console.log("chunk.data keys:", Object.keys(d));
                    console.log("chunk.data JSON:", JSON.stringify(d).substring(0, 2000));
                    if (d.data) {
                        if (Buffer.isBuffer(d.data)) {
                            console.log("chunk.data.data IS Buffer, decoded:", d.data.toString('utf-8'));
                        } else if (Array.isArray(d.data)) {
                            console.log("chunk.data.data is array, decoded:", Buffer.from(d.data).toString('utf-8'));
                        } else {
                            console.log("chunk.data.data type:", typeof d.data, "value:", JSON.stringify(d.data).substring(0, 500));
                        }
                    }
                } else {
                    console.log("chunk.data value:", String(d).substring(0, 2000));
                }
            }
        }
    } catch (err) {
        console.error(err);
    }
}
run();
