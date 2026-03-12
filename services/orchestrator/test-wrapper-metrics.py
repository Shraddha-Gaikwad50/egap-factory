import os
import requests
from vertexai import agent_engines

from google.adk.agents import Agent
def simple_tool(query: str) -> str:
    return "This is a simple tool response."

class SafeTestEGAPApp:
    def __init__(self, agent_config):
        self.config = agent_config
        self.agent_framework = "google-adk" # Spoof ADK framework for Vertex AI
        
        agent = Agent(
            name="test_wrapper_agent",
            instruction=agent_config.get("goal", "Be helpful"),
            tools=[simple_tool],
        )

        from vertexai.agent_engines.templates.adk import AdkApp
        from google.adk.sessions.in_memory_session_service import InMemorySessionService
        from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService
        from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
        import queue

        self._adk_app = AdkApp(
            agent=agent,
            session_service_builder=InMemorySessionService,
            memory_service_builder=InMemoryMemoryService,
            artifact_service_builder=InMemoryArtifactService
        )

    def set_up(self):
        # 1. Provide project ID and init the instrumentor exactly like ADK does!
        import os
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
        try:
            from vertexai.agent_engines.templates.adk import _default_instrumentor_builder
            self.instrumentor = _default_instrumentor_builder(
                project_id=project_id,
                enable_tracing=True,
                enable_logging=True
            )
        except Exception as e:
            print("Failed to initialize telemetry:", e)
            
        self._ensure_vertex_auth()

    def _ensure_vertex_auth(self):
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "1"
        os.environ["GOOGLE_CLOUD_PROJECT"] = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
        os.environ["GOOGLE_CLOUD_LOCATION"] = os.environ.get("GOOGLE_CLOUD_LOCATION", "")

    def query(self, message: str, user_id: str, session_id: str = None) -> str:
        full_response = ""
        for chunk in self._adk_app.stream_query(
            message=message,
            user_id=user_id,
            session_id=session_id
        ):
            if chunk.get("type") == "message" and "content" in chunk:
                full_response += chunk["content"]
        return full_response

if __name__ == "__main__":
    import vertexai
    project_id = "gls-training-486405"
    location = "us-central1"
    bucket_name = f"{project_id}-adk-staging"
    vertexai.init(project=project_id, location=location, staging_bucket=f"gs://{bucket_name}")

    app = SafeTestEGAPApp({"name": "Test Wrapper Metrics", "goal": "Answer questions"})
    print("Deploying test wrapper...")
    remote_app = agent_engines.create(
        app,
        requirements=[
            "google-adk>=0.4.0",
            "google-cloud-aiplatform[agent_engines]>=1.62.0",
            "google-cloud-storage>=2.14.0",
            "google-genai>=1.0.0",
            "requests>=2.31.0"
        ],
        env_vars={
            "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "true"
        },
        display_name="Test Wrapper Metrics Agent",
        description="Testing metrics explicitly in EGAP App"
    )
    print("Deployed successfully!")
    print(remote_app.resource_name)
