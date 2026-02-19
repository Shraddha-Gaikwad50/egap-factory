
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID || 'gls-training-486405';
const LOCATION = 'asia-south1';

async function main() {
    console.log(`Testing @google/genai with ADC (No API Key)...`);

    try {
        // Attempt 1: vertexAI: true
        console.log('Attempting with vertexAI: true...');
        // @ts-ignore
        const client1 = new GoogleGenAI({
            project: PROJECT_ID,
            location: LOCATION,
            vertexAI: true
        });
        // @ts-ignore
        const resp1 = await client1.models.list();
        console.log('✅ Success with vertexAI: true');
        return;
    } catch (e: any) {
        console.log('❌ Failed with vertexAI: true:', e.message);
    }

    try {
        // Attempt 2: vertexai: true (lowercase)
        console.log('Attempting with vertexai: true...');
        // @ts-ignore
        const client2 = new GoogleGenAI({
            project: PROJECT_ID,
            location: LOCATION,
            vertexai: true
        });
        // @ts-ignore
        const resp2 = await client2.models.list();
        console.log('✅ Success with vertexai: true');
        return;
    } catch (e: any) {
        console.log('❌ Failed with vertexai: true:', e.message);
    }
}

main();
