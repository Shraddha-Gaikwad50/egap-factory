ACCESS_TOKEN=$(gcloud auth print-access-token)
curl -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  https://us-central1-aiplatform.googleapis.com/v1beta1/projects/910005263485/locations/us-central1/reasoningEngines/4500986088231272448:query \
  -d '{
    "classMethod": "query",
    "input": {
      "message": "Hello, how are you?",
      "user_id": "test_gcp_metrics",
      "session_id": "test_gcp_metrics_session_5"
    }
  }'
