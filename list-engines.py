import vertexai
from vertexai.preview import reasoning_engines

vertexai.init(project="gls-training-486405", location="us-central1")

engines = reasoning_engines.ReasoningEngine.list()
print("Found Reasoning Engines:")
for e in engines:
    print(f"- {e.resource_name}")
