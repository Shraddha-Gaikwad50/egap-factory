import os
import sys
import vertexai
from vertexai.preview import reasoning_engines
from vertexai.preview.reasoning_engines.templates.adk import AdkApp
from google.adk.agents import Agent

def main():
    project_id = "gls-training-486405"
    location = "us-central1"
    
    # 1. Set environment variables so google-genai initializes correctly with Vertex AI
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "1"
    os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
    os.environ["GOOGLE_CLOUD_LOCATION"] = location

    print(f"Initializing Vertex AI for {project_id} in {location}...")
    
    from google.cloud import storage
    bucket_name = f"{project_id}-adk-staging"
    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(bucket_name)
    if not bucket.exists():
        print(f"Creating bucket {bucket_name}...")
        bucket.create(location=location)

    vertexai.init(project=project_id, location=location, staging_bucket=f"gs://{bucket_name}")

    # 2. Create a simple ADK Agent
    # For this test, we don't attach custom tools to avoid complex serialization issues
    print("Creating simple ADK Agent...")
    agent = Agent(
        name="metrics_test_agent",
        model="gemini-2.5-flash",
        instruction="You are a helpful assistant. Just respond to greetings.",
    )

    # 3. Wrap the Agent in the official AdkApp template
    # This is required for Vertex AI to populate the Dashboard, Metrics, Traces, etc.
    from google.adk.sessions.in_memory_session_service import InMemorySessionService
    from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService
    from google.adk.memory.in_memory_memory_service import InMemoryMemoryService

    app = AdkApp(
        agent=agent,
        env_vars={
            "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "true"
        },
        session_service_builder=InMemorySessionService,
        artifact_service_builder=InMemoryArtifactService,
        memory_service_builder=InMemoryMemoryService,
    )

    print("Deploying Reasoning Engine with Telemetry enabled...")
    
    # 4. Deploy
    from vertexai import agent_engines
    remote_app = agent_engines.create(
        app,
        requirements=[
            "google-adk>=0.3.0",
            # Include agent_engines extras to ensure OpenTelemetry packages are installed in the container
            "google-cloud-aiplatform[agent_engines]>=1.62.0",
            "google-cloud-storage>=2.14.0",
            "google-genai>=1.0.0",
            "requests>=2.31.0",
        ],
        env_vars={
            "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "true"
        },
        display_name="Metrics Test ADK Agent",
        description="A simple agent to test GCP metrics and telemetry."
    )

    print(f"Deployed! Resource Name: {remote_app.resource_name}")
    print("---------------------------------------------------------")
    print("Test Instructions:")
    print("1. Go to GCP Console -> Vertex AI -> Agent Engine -> Agents")
    print("2. Click on 'Metrics Test ADK Agent'")
    print("3. Send a few messages in the Playground tab")
    print("4. Check if the Dashboard, Sessions, and Traces tabs begin populating!")

if __name__ == "__main__":
    main()
