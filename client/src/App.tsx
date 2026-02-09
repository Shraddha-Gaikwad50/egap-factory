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
  tools: string[];
}

function App() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    role: '',
    goal: '',
    systemPrompt: '',
    tools: [],
  });

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/tools');
      if (!response.ok) throw new Error('Failed to fetch tools');
      const data = await response.json();
      setTools(data);
    } catch (error) {
      console.error('Error fetching tools:', error);
      setErrorMessage('Failed to load tools. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSuccessMessage('');
    setErrorMessage('');

    try {
      const response = await fetch('http://localhost:3000/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Failed to create agent');

      setSuccessMessage('🎉 Agent deployed successfully!');
      setFormData({
        name: '',
        role: '',
        goal: '',
        systemPrompt: '',
        tools: [],
      });
    } catch (error) {
      console.error('Error creating agent:', error);
      setErrorMessage('Failed to deploy agent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
            Agent Wizard
          </h1>
          <p className="mt-2 text-gray-400">Configure and deploy your AI agent</p>
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
        <form onSubmit={handleSubmit} className="bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-8 space-y-6">
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

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Deploying...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Deploy Agent</span>
              </>
            )}
          </button>
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
