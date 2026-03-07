"""
EGAP ADK Agent — Architecture Spec v1.0 Compliant
Uses Google Agent Development Kit (ADK) for agent logic, reasoning loops,
and HITL support via before_tool_callback.

This module defines the base EGAPAgent class that:
- Uses google.adk.Agent with structured reasoning
- Registers tools dynamically from MCP Server discovery
- Implements before_tool_callback for HITL gating (WRITE tools → suspend)
- Implements after_tool_callback for usage/cost logging
- Deploys to Vertex AI Agent Engine
"""

import os
import json
import logging
import requests
from typing import Optional

from google.adk.agents import Agent
from google.adk.tools import FunctionTool
from google.genai import types

logger = logging.getLogger("egap-adk-agent")
logging.basicConfig(level=logging.INFO)

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID", "gls-training-486405")
LOCATION = os.getenv("LOCATION", "us-central1")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")
FACTORY_URL = os.getenv("FACTORY_URL", "http://localhost:3000")


# ─────────────────────────────────────────────────────────────────────────────
# HITL Callback — Intercepts WRITE tools before execution
# ─────────────────────────────────────────────────────────────────────────────

def hitl_before_tool_callback(
    tool: FunctionTool,
    args: dict,
    tool_context: "google.adk.tools.ToolContext",
) -> Optional[dict]:
    """
    Architecture Spec: HITL Suspend & Resume.
    
    - READ tools: return None (allow execution)
    - WRITE tools: create a PENDING_APPROVAL task via the Factory API,
      then return a 'suspended' response so the agent does NOT execute the tool.
      The task will be resumed via A2A POST /resume after admin approval.
    """
    tool_name = tool.name if hasattr(tool, 'name') else str(tool)
    
    # Determine if tool is WRITE via naming convention or metadata
    write_tools = {"send_email", "save_file"}
    
    if tool_name in write_tools:
        logger.info(f"🔒 HITL INTERCEPT: Tool '{tool_name}' is a WRITE tool. Suspending execution.")
        
        # Get agent context info
        agent_id = getattr(tool_context, 'agent_id', None) or os.getenv("AGENT_ID", "unknown")
        trace_id = getattr(tool_context, 'trace_id', None) or "no-trace"
        
        # Create HITL task in the Factory DB via API
        try:
            task_payload = {
                "description": f"Agent requested WRITE operation: {tool_name}",
                "agentId": agent_id,
                "inputPayload": args,
                "traceId": trace_id,
            }
            
            resp = requests.post(
                f"{FACTORY_URL}/api/tasks/hitl",
                json=task_payload,
                timeout=10,
            )
            
            if resp.ok:
                task_data = resp.json()
                task_id = task_data.get("id", "unknown")
                logger.info(f"⏳ HITL Task {task_id} created. Execution suspended.")
            else:
                task_id = "error"
                logger.error(f"❌ Failed to create HITL task: {resp.text}")
                
        except Exception as e:
            task_id = "error"
            logger.error(f"❌ Failed to create HITL task: {e}")
        
        # Return a dict to SKIP tool execution and provide feedback to the agent
        return {
            "status": "PENDING_APPROVAL",
            "message": (
                f"Tool '{tool_name}' requires Human-in-the-Loop approval. "
                f"A task (ID: {task_id}) has been created for admin review. "
                f"Execution is suspended until approval."
            ),
        }
    
    # READ tools — allow execution
    logger.info(f"✅ Tool '{tool_name}' is a READ tool. Allowing execution.")
    return None


def hitl_after_tool_callback(
    tool: FunctionTool,
    args: dict,
    tool_context: "google.adk.tools.ToolContext",
    tool_response: dict,
) -> Optional[dict]:
    """
    Architecture Spec: AgentOps Cost Accounting.
    
    Logs tool execution for cost tracking and observability.
    """
    tool_name = tool.name if hasattr(tool, 'name') else str(tool)
    
    logger.info(f"📊 Tool executed: {tool_name}")
    
    # Log to Factory for cost accounting
    try:
        agent_id = getattr(tool_context, 'agent_id', None) or os.getenv("AGENT_ID", "unknown")
        requests.post(
            f"{FACTORY_URL}/api/usage-log",
            json={
                "agentId": agent_id,
                "action": f"tool_execute_{tool_name}",
                "tokens": 0,
                "costUsd": 0,
                "metadata": {"tool": tool_name, "args_keys": list(args.keys())},
            },
            timeout=5,
        )
    except Exception as e:
        logger.warning(f"Failed to log tool usage: {e}")
    
    return None  # Don't modify the response


# ─────────────────────────────────────────────────────────────────────────────
# MCP Tool Wrappers — Registered as ADK FunctionTools
# ─────────────────────────────────────────────────────────────────────────────

def search_vertex_docs(query: str) -> str:
    """Search the official Vertex AI documentation for technical answers.
    This is a READ tool — executes immediately.
    
    Args:
        query: The search query string.
    
    Returns:
        Relevant documentation snippets.
    """
    mcp_url = os.getenv("MCP_HUB_URL", "http://localhost:8080")
    try:
        # Call MCP Server via standard MCP client call
        # In production, this would use the MCP client SDK
        resp = requests.post(
            f"{mcp_url}/mcp",
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {"name": "search_vertex_docs", "arguments": {"query": query}},
                "id": 1,
            },
            timeout=30,
        )
        if resp.ok:
            result = resp.json()
            if "result" in result:
                content = result["result"].get("content", [])
                return content[0].get("text", "No results") if content else "No results"
        return "Error calling MCP search tool"
    except Exception as e:
        return f"MCP tool error: {e}"


def send_email(to_email: str, subject: str, body: str) -> str:
    """Send an email to a recipient. Requires subject and body.
    ⚠️ WRITE tool — requires HITL approval before execution.
    
    Args:
        to_email: Recipient email address.
        subject: Email subject line.
        body: Email body content.
    
    Returns:
        Confirmation or status message.
    """
    # This function body only runs AFTER HITL approval (via A2A resume).
    # The before_tool_callback intercepts it first.
    mcp_url = os.getenv("MCP_HUB_URL", "http://localhost:8080")
    try:
        resp = requests.post(
            f"{mcp_url}/mcp",
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {
                    "name": "send_email",
                    "arguments": {"to_email": to_email, "subject": subject, "body": body},
                },
                "id": 1,
            },
            timeout=30,
        )
        if resp.ok:
            result = resp.json()
            content = result.get("result", {}).get("content", [])
            return content[0].get("text", "Email sent") if content else "Email sent"
        return "Error calling MCP email tool"
    except Exception as e:
        return f"MCP tool error: {e}"


def save_file(filename: str, content: str) -> str:
    """Save text content to a file in Google Cloud Storage.
    ⚠️ WRITE tool — requires HITL approval before execution.
    
    Args:
        filename: Name of the file to create.
        content: Text content to save.
    
    Returns:
        GCS URI of the saved file.
    """
    mcp_url = os.getenv("MCP_HUB_URL", "http://localhost:8080")
    try:
        resp = requests.post(
            f"{mcp_url}/mcp",
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {
                    "name": "save_file",
                    "arguments": {"filename": filename, "content": content},
                },
                "id": 1,
            },
            timeout=30,
        )
        if resp.ok:
            result = resp.json()
            content_items = result.get("result", {}).get("content", [])
            return content_items[0].get("text", "File saved") if content_items else "File saved"
        return "Error calling MCP save_file tool"
    except Exception as e:
        return f"MCP tool error: {e}"


# ─────────────────────────────────────────────────────────────────────────────
# Agent Factory — Creates ADK Agent instances from DB configuration
# ─────────────────────────────────────────────────────────────────────────────

# Tool registry — maps tool names to Python functions
TOOL_REGISTRY = {
    "search_vertex_docs": search_vertex_docs,
    "send_email": send_email,
    "save_file": save_file,
}


def create_egap_agent(
    agent_id: str,
    name: str,
    system_prompt: str,
    tool_names: list[str],
    model_name: str = MODEL_NAME,
) -> Agent:
    """
    Create an ADK Agent from EGAP configuration.
    
    This is the core factory function that builds an ADK Agent with:
    - System prompt from the Agent Blueprint in the DB
    - Tools resolved from the tool registry
    - HITL before_tool_callback for WRITE tool interception
    - after_tool_callback for usage logging
    
    Args:
        agent_id: The agent's UUID from the database.
        name: Human-readable agent name.
        system_prompt: The agent's system instruction.
        tool_names: List of tool names to attach.
        model_name: Gemini model to use.
    
    Returns:
        A configured google.adk.agents.Agent instance.
    """
    # Resolve tools from registry
    agent_tools = []
    for tool_name in tool_names:
        if tool_name in TOOL_REGISTRY:
            agent_tools.append(TOOL_REGISTRY[tool_name])
            logger.info(f"  📎 Attached tool: {tool_name}")
        else:
            logger.warning(f"  ⚠️ Unknown tool: {tool_name} — skipping")
    
    # Set agent_id in env so callbacks can reference it
    os.environ["AGENT_ID"] = agent_id
    
    agent = Agent(
        name=name.lower().replace(" ", "_"),
        model=model_name,
        instruction=system_prompt,
        tools=agent_tools,
        before_tool_callback=hitl_before_tool_callback,
        after_tool_callback=hitl_after_tool_callback,
    )
    
    logger.info(f"✅ Created ADK Agent: {name} (id={agent_id}, tools={tool_names})")
    return agent
