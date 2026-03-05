"""
ADK Deployer — Architecture Spec v1.0 Compliant
Deploys real ADK agents to Vertex AI Agent Engine (Reasoning Engine).

Called by the orchestrator's POST /api/agents endpoint.
Receives agent config as JSON argument and deploys to Vertex AI.
"""

import sys
import os
import json
import logging

import vertexai
from google.cloud import storage
from vertexai.preview import reasoning_engines

# Add adk-agent to path so we can import it
# In Docker: /app/dist/adk_deployer.py -> adk-agent at /app/services/adk-agent
# Locally: /services/orchestrator/src/adk_deployer.py -> adk-agent at /services/adk-agent
_base = os.path.dirname(os.path.abspath(__file__))
_candidates = [
    os.path.join(_base, '..', 'services', 'adk-agent'),  # Docker: /app/dist/../services/adk-agent
    os.path.join(_base, '..', 'adk-agent'),               # Local fallback: src/../adk-agent
    os.path.join(_base, '..', '..', 'adk-agent'),         # Alternative local
]
for _p in _candidates:
    if os.path.isdir(_p):
        sys.path.insert(0, _p)
        break

from agent import create_egap_agent

logger = logging.getLogger("adk-deployer")
logging.basicConfig(level=logging.INFO)


def main():
    if len(sys.argv) < 2:
        print("Error: Missing JSON payload.", file=sys.stderr)
        sys.exit(1)

    try:
        agent_data = json.loads(sys.argv[1])
    except Exception as e:
        print(f"Error parsing JSON: {e}", file=sys.stderr)
        sys.exit(1)

    project_id = os.getenv("PROJECT_ID", "gls-training-486405")
    location = os.getenv("LOCATION", "us-central1")
    bucket_name = f"{project_id}-adk-staging"

    # 1. Ensure staging bucket exists
    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(bucket_name)
    if not bucket.exists():
        bucket.create(location=location)
        logger.info(f"Created staging bucket: gs://{bucket_name}")

    vertexai.init(
        project=project_id,
        location=location,
        staging_bucket=f"gs://{bucket_name}",
    )

    # 2. Extract agent properties from the JSON payload
    agent_id = agent_data.get("id", "unknown-id")
    name = agent_data.get("name", "Unnamed Agent")
    role = agent_data.get("role", "")
    goal = agent_data.get("goal", "")
    sys_prompt = agent_data.get("systemPrompt", "")
    tool_names = agent_data.get("tools", [])

    logger.info(f"🚀 Deploying ADK Agent: {name} (id={agent_id})")
    logger.info(f"   Tools: {tool_names}")

    # 3. Create the ADK Agent using the factory function
    adk_agent = create_egap_agent(
        agent_id=agent_id,
        name=name,
        system_prompt=sys_prompt,
        tool_names=tool_names,
    )

    try:
        # 4. Deploy to Vertex AI Reasoning Engine
        remote_app = reasoning_engines.ReasoningEngine.create(
            adk_agent,
            requirements=[
                "google-adk>=0.3.0",
                "google-cloud-aiplatform>=1.60.0",
                "google-cloud-storage>=2.14.0",
                "google-genai>=1.0.0",
                "requests>=2.31.0",
            ],
            display_name=name,
            description=f"EGAP Agent: {role} — {goal}",
        )

        # 5. Print the resource name to stdout so the TS orchestrator can read it
        print(remote_app.resource_name)
        logger.info(f"☁️ ADK Agent deployed: {remote_app.resource_name}")
        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        logger.error(f"❌ Deployment failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
