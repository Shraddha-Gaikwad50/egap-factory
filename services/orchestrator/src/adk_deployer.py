import sys
import json
import vertexai
from google.cloud import storage
from vertexai.preview import reasoning_engines

def main():
    if len(sys.argv) < 2:
        print("Error: Missing JSON payload.", file=sys.stderr)
        sys.exit(1)
        
    try:
        agent_data = json.loads(sys.argv[1])
    except Exception as e:
        print(f"Error parsing JSON: {e}", file=sys.stderr)
        sys.exit(1)

    project_id = "gls-training-486405"
    location = "us-central1"
    bucket_name = "gls-training-486405-adk-staging"
    
    # 1. Ensure staging bucket exists
    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(bucket_name)
    if not bucket.exists():
        bucket.create(location=location)

    vertexai.init(project=project_id, location=location, staging_bucket=f"gs://{bucket_name}")

    # Extract properties
    agent_id = agent_data.get("id", "unknown-id")
    name = agent_data.get("name", "Unnamed Agent")
    sys_prompt = agent_data.get("systemPrompt", "")
    
    # Define a clean agent class with baked-in system instructions
    class DynamicADKAgent:
        def __init__(self, project_id: str, location: str, system_instruction: str):
            self.project_id = project_id
            self.location = location
            self.system_instruction = system_instruction
            self.model_name = "gemini-2.5-flash"

        def set_up(self):
            import vertexai
            from vertexai.generative_models import GenerativeModel
            vertexai.init(project=self.project_id, location=self.location)
            # You can inject tools into the model here in future updates
            self.model = GenerativeModel(
                self.model_name,
                system_instruction=[self.system_instruction]
            )

        def query(self, input_text: str) -> str:
            response = self.model.generate_content(input_text)
            return response.text

    # Instantiate the agent with the dynamic prompt
    agent_instance = DynamicADKAgent(
        project_id=project_id,
        location=location,
        system_instruction=sys_prompt
    )

    try:
        # 2. Deploy to Reasoning Engine
        remote_app = reasoning_engines.ReasoningEngine.create(
            agent_instance,
            requirements=[
                "google-cloud-aiplatform",
                "google-cloud-storage",
            ],
            display_name=name,
        )
        # 3. Print the resource name to stdout so TS can read it
        print(remote_app.resource_name)
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
