import { useEffect, useState } from 'react';

interface Tool {
  id: string;
  name: string;
  description?: string;
}

interface AgentFormData {
  name: string;
  role: string;
  goal: string;
  systemPrompt: string;
  knowledgeBaseId: string;
  tools: string[];
  status: string; // Add status field
}

interface PromptHistory {
  id: string;
  version: number;
  prompt: string;
  createdAt: string;
}

function App() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // New state for editing and history
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [history, setHistory] = useState<PromptHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // New state for workspace
  const [workspace, setWorkspace] = useState('General');
  const [agents, setAgents] = useState<AgentFormData[]>([]); // We reuse the type for display simple list

  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    role: '',
    goal: '',
    systemPrompt: '',
    knowledgeBaseId: '', // Default empty
    tools: [],
    status: 'LIVE', // Default
  });

  useEffect(() => {
    fetchTools();
    fetchAgents();
  }, [workspace]); // Re-fetch agents when workspace changes

  const fetchTools = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/tools/available');
      if (!response.ok) throw new Error('Failed to fetch tools');
      const data = await response.json();
      setTools(data);
    } catch (error) {
      console.error('Error fetching tools:', error);
      // Client-side fallback if the API is completely unreachable
      setTools([
        { id: 'search', name: 'search', description: 'Google Search (Offline Fallback)' },
        { id: 'email', name: 'email', description: 'Send Emails (Offline Fallback)' },
        { id: 'github', name: 'github', description: 'GitHub Integration (Offline Fallback)' }
      ]);
      setErrorMessage('Using offline tools (Factory API unreachable).');
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const response = await fetch(`http://localhost:3000/api/agents?workspace=${workspace}`);
      if (response.ok) {
        const data = await response.json();
        setAgents(data);
      }
    } catch (e) {
      console.error("Failed to fetch agents", e);
    }
  };

  // Helper to load an agent for editing (Simulated for now, normally would be a route or list selection)
  const handleLoadId = async (id: string) => {
    setLoading(true);
    try {
      // In a real app we would have a proper GET endpoint
      // Here we will just set the ID so the next submit is a PUT
      // And we rely on the user to fill in the current details (or implementation of GET /api/agents/:id)
      setEditingAgentId(id);

      // Simulate fetching agent details from the list we already have
      const existingAgent = agents.find((a: any) => a.id === id);
      if (existingAgent) {
        setFormData({
          ...existingAgent,
          knowledgeBaseId: existingAgent.knowledgeBaseId || '',
          status: existingAgent.status || 'LIVE'
        });
        setSuccessMessage(`⚠️  Editing Mode: Agent ID ${id} set. Submit to UPDATE.`);
      } else {
        setSuccessMessage(`⚠️  Editing Mode: Agent ID ${id} set. (Details not pre-filled locally)`);
      }

    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleToolToggle = (toolId: string) => {
    setFormData(prev => ({
      ...prev,
      tools: prev.tools.includes(toolId)
        ? prev.tools.filter(id => id !== toolId)
        : [...prev.tools, toolId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent, status: string = 'LIVE') => {
    e.preventDefault();
    setSubmitting(true);
    setSuccessMessage('');
    setErrorMessage('');

    try {
      const url = editingAgentId
        ? `http://localhost:3000/api/agents/${editingAgentId}`
        : 'http://localhost:3000/api/agents';

      const method = editingAgentId ? 'PUT' : 'POST';

      // Include workspace and status in the payload
      const payload = { ...formData, workspace, status };

      // Update local form state status too just in case
      setFormData(prev => ({ ...prev, status }));

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Failed to ${editingAgentId ? 'update' : 'create'} agent`);

      const data = await response.json();

      setSuccessMessage(`🎉 Agent ${editingAgentId ? 'updated' : 'saved'} as ${status} in ${workspace}!`);

      // Refresh the list
      fetchAgents();

      if (!editingAgentId) {
        // If created, reset form
        setFormData({
          name: '',
          role: '',
          goal: '',
          systemPrompt: '',
          knowledgeBaseId: '',
          tools: [],
          status: 'LIVE',
        });
      } else {
        // If updated, refresh history if returned
        if (data.history) {
          setHistory(data.history);
        }
      }
    } catch (error) {
      console.error('Error saving agent:', error);
      setErrorMessage('Failed to save agent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
              Agent Wizard
            </h1>
            <p className="mt-2 text-gray-400">Configure and deploy your AI agent</p>
          </div>

          {/* Workspace Switcher */}
          <div className="flex flex-col items-end">
            <label className="text-xs text-gray-500 uppercase tracking-wide mb-1">Workspace</label>
            <select
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="General">General</option>
              <option value="IT">IT</option>
              <option value="HR">HR</option>
              <option value="Finance">Finance</option>
              <option value="Sales">Sales</option>
            </select>
          </div>
        </div>

        {/* Agent List Preview (Group the Cards) */}
        {agents.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <span>📂</span> Existing Agents in {workspace}
            </h2>
            <div className="grid grid-cols-1 gap-3 max-h-48 overflow-y-auto">
              {agents.map((agent: any) => (
                <div key={agent.id} className="bg-gray-800/40 border border-gray-700 p-3 rounded-lg flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-purple-300">{agent.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${agent.status === 'LIVE'
                        ? 'bg-green-900/30 text-green-400 border-green-800'
                        : 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                        {agent.status || 'LIVE'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{agent.role}</p>
                  </div>
                  <button
                    onClick={() => handleLoadId(agent.id)}
                    className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-gray-300"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* Dev Helper: Edit Mode Trigger */}
        <div className="mb-8 p-4 bg-gray-800 rounded-lg border border-gray-700">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Developer Mode: Edit Existing Agent</label>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              placeholder="Paste Agent ID here to Switch to Update Mode"
              className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white"
              onChange={(e) => {
                if (e.target.value.length > 10) handleLoadId(e.target.value);
                else setEditingAgentId(null);
              }}
            />
          </div>
          {editingAgentId && <p className="text-xs text-yellow-500 mt-1">Mode: UPDATE (History tracking enabled)</p>}
        </div>

        {/* Success Alert */}
        {successMessage && (
          <div className="mb-6 p-4 bg-green-900/50 border border-green-500 rounded-xl text-green-300 flex items-center gap-3 animate-pulse">
            <svg className="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">{successMessage}</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-xl text-red-300 flex items-center gap-3">
            <svg className="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Main Form Card */}
        <form className="bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-8 space-y-6">
          {/* Name Input */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
              Agent Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              required
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
              placeholder="e.g., Research Assistant"
            />
          </div>

          {/* Role Input */}
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-300 mb-2">
              Role
            </label>
            <input
              type="text"
              id="role"
              name="role"
              value={formData.role}
              onChange={handleInputChange}
              required
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
              placeholder="e.g., Data Analyst"
            />
          </div>

          {/* Knowledge Base ID Input (Optional) */}
          <div>
            <label htmlFor="knowledgeBaseId" className="block text-sm font-medium text-gray-300 mb-2">
              Knowledge Base ID <span className="text-gray-500 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              id="knowledgeBaseId"
              name="knowledgeBaseId"
              value={formData.knowledgeBaseId}
              onChange={handleInputChange}
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
              placeholder="e.g., my-custom-datastore"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank to use the default Vertex AI Data Store linked to this project.
            </p>
          </div>

          {/* Goal Input */}
          <div>
            <label htmlFor="goal" className="block text-sm font-medium text-gray-300 mb-2">
              Goal
            </label>
            <input
              type="text"
              id="goal"
              name="goal"
              value={formData.goal}
              onChange={handleInputChange}
              required
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
              placeholder="e.g., Analyze datasets and provide insights"
            />
          </div>

          {/* System Prompt Text Area */}
          <div>
            <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-300 mb-2">
              System Prompt
            </label>
            <textarea
              id="systemPrompt"
              name="systemPrompt"
              value={formData.systemPrompt}
              onChange={handleInputChange}
              required
              rows={5}
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 resize-none"
              placeholder="Provide detailed instructions for your agent..."
            />

            {/* Version History Toggle */}
            {history.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                >
                  {showHistory ? '▼ Hide Version History' : '▶ Show Version History'}
                </button>

                {showHistory && (
                  <div className="mt-2 space-y-2 bg-gray-900/50 rounded p-2 max-h-40 overflow-y-auto">
                    {history.map((h) => (
                      <div key={h.id} className="text-xs text-gray-400 border-b border-gray-700 pb-2 last:border-0">
                        <div className="flex justify-between">
                          <span className="font-bold text-gray-300">v{h.version}</span>
                          <span>{new Date(h.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 line-clamp-2">{h.prompt}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tools Checkbox List */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Available Tools
            </label>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
              </div>
            ) : tools.length === 0 ? (
              <div className="text-gray-500 text-center py-4 bg-gray-900/30 rounded-xl border border-gray-700">
                No tools available
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-2">
                {tools.map((tool) => (
                  <label
                    key={tool.id}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 border ${formData.tools.includes(tool.id)
                      ? 'bg-purple-900/40 border-purple-500'
                      : 'bg-gray-900/30 border-gray-700 hover:border-gray-500'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.tools.includes(tool.id)}
                      onChange={() => handleToolToggle(tool.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{tool.name}</p>
                      {tool.description && (
                        <p className="text-xs text-gray-500 truncate">{tool.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              disabled={submitting || loading}
              onClick={(e) => handleSubmit(e, 'DRAFT')}
              className="flex-1 py-4 px-6 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 border border-gray-600"
            >
              {submitting ? 'Saving...' : '💾 Save as Draft'}
            </button>

            <button
              type="button"
              disabled={submitting || loading}
              onClick={(e) => handleSubmit(e, 'LIVE')}
              className="flex-1 py-4 px-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transition-all duration-300 flex items-center justify-center gap-2"
            >
              {submitting ? 'Publishing...' : '🚀 Publish Live'}
            </button>
          </div>
        </form>

        {/* Footer */}
        <p className="text-center text-gray-600 text-sm mt-8">
          Powered by EGAP Factory
        </p>
      </div>
    </div>
  );
}

export default App;
