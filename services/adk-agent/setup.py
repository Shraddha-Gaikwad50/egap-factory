"""
Setup for EGAP ADK Agent package.

This setup.py declares the package name as "egap_agent" (valid Python identifier).

When built as a wheel (.whl) and passed to ReasoningEngine.create(extra_packages),
Vertex AI installs it, making `from egap_agent.core import create_egap_agent` work.
"""

from setuptools import setup, find_packages

setup(
    name="egap-adk-agent",
    version="1.0.0",
    description="EGAP ADK Agent — creates ADK agents with HITL callbacks and MCP tools",
    packages=find_packages(),
    install_requires=[
        "google-adk>=0.3.0",
        "google-cloud-aiplatform>=1.62.0",
        "google-cloud-storage>=2.14.0",
        "google-genai>=1.0.0",
        "requests>=2.31.0",
    ],
)
