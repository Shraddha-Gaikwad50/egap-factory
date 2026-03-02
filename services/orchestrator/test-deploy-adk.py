import os
import sys
import vertexai
from vertexai.preview import reasoning_engines

def main():
    project_id = "gls-training-486405"
    location = "us-central1"
    
    from google.cloud import storage
    
    bucket_name = "gls-training-486405-adk-staging"
    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(bucket_name)
    if not bucket.exists():
        print(f"Creating bucket {bucket_name}...")
        bucket.create(location=location)
    else:
        print(f"Bucket {bucket_name} already exists.")

    print(f"Initializing Vertex AI for {project_id} in {location}...")
    vertexai.init(project=project_id, location=location, staging_bucket=f"gs://{bucket_name}")

    # A simple Langchain/ADK agent class
    class SimpleAgent:
        def __init__(self, project: str, location: str):
            pass

        def set_up(self):
            import vertexai
            from vertexai.generative_models import GenerativeModel
            vertexai.init(project="gls-training-486405", location="us-central1")
            self.model = GenerativeModel("gemini-2.5-flash")

        def query(self, input_text: str) -> str:
            response = self.model.generate_content(input_text)
            return response.text

    print("Deploying Reasoning Engine...")
    
    # Needs a requirements.txt equivalent, we pass packages
    remote_app = reasoning_engines.ReasoningEngine.create(
        SimpleAgent(project=project_id, location=location),
        requirements=[
            "google-cloud-aiplatform",
        ],
        display_name="Factory Test ADK Agent",
    )

    print(f"Deployed! Resource Name: {remote_app.resource_name}")

if __name__ == "__main__":
    main()
