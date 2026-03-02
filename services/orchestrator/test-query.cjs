const { ReasoningEngineExecutionServiceClient } = require('@google-cloud/aiplatform');
const client = new ReasoningEngineExecutionServiceClient({ apiEndpoint: 'us-central1-aiplatform.googleapis.com' });

async function run() {
    try {
        const result = await client.queryReasoningEngine({
            name: 'projects/910005263485/locations/us-central1/reasoningEngines/8154359762121654272',
            classMethod: 'query',
            input: {
                fields: {
                    input_text: { stringValue: 'Hello! Who are you?' }
                }
            }
        });
        console.log(JSON.stringify(result[0], null, 2));
    } catch (err) {
        console.error(err);
    }
}
run();
