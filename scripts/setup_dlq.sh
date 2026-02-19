#!/bin/bash

# Load env vars
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PROJECT_ID=${PROJECT_ID:-gls-training-486405}
DLQ_TOPIC="egap-dlq-topic"
DLQ_SUB="egap-dlq-sub"
MAIN_SUB="egap-orchestrator-sub"

echo "🔧 Setting up Dead Letter Queue for Project: $PROJECT_ID"

# 1. Create Dead Letter Topic
echo "1️⃣  Creating Dead Letter Topic: $DLQ_TOPIC..."
gcloud pubsub topics create $DLQ_TOPIC --project=$PROJECT_ID || echo "   Topic exists, skipping."

# 2. Create Dead Letter Subscription (to inspect failed messages)
echo "2️⃣  Creating Dead Letter Subscription: $DLQ_SUB..."
gcloud pubsub subscriptions create $DLQ_SUB \
    --topic=$DLQ_TOPIC \
    --project=$PROJECT_ID || echo "   Subscription exists, skipping."

# 3. Update Orchestrator Subscription to use DLQ
echo "3️⃣  Updating Main Subscription ($MAIN_SUB) to use DLQ..."
gcloud pubsub subscriptions update $MAIN_SUB \
    --dead-letter-topic=$DLQ_TOPIC \
    --max-delivery-attempts=5 \
    --project=$PROJECT_ID

echo "✅ DLQ Setup Complete!"
echo "   Messages failed 5 times will be moved to: $DLQ_SUB"
