
import { useEffect, useState, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────
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

interface Message {
    id: string;
    role: string;
    content: string;
    createdAt: string;
}

interface DashboardStats {
    totalCost: number;
    activeAgents: number;
    pendingTasks: number;
    zombieCount: number;
    traces: any[];
    perAgentCosts: { agentId: string; agentName: string; totalCost: number; totalTokens: number; invocations: number }[];
}

interface Task {
    id: string;
    description: string;
    status: string;
    createdAt: string;
    agent?: { name: string };
}

// ── App Component ────────────────────────────────────────────────────
function App() {
    // State: UI
    const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'user' | null>(null);
    const [activeTab, setActiveTab] = useState<'create' | 'tools' | 'test' | 'govern' | 'observe'>('test');
    const [_loading, setLoading] = useState(true);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // State: Emergency Stop
    const [emergencyActive, setEmergencyActive] = useState(false);

    // State: Create Agent
    const [tools, setTools] = useState<Tool[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
    const [formData, setFormData] = useState<AgentFormData>({
        name: '', role: '', goal: '', systemPrompt: '', tools: [],
    });

    // State: Create Tool
    const [toolFormData, setToolFormData] = useState({ name: '', description: '', parameters: '' });
    const [submittingTool, setSubmittingTool] = useState(false);

    // State: Test Flight
    const [selectedAgentId, setSelectedAgentId] = useState<string>('');
    const [agents, setAgents] = useState<any[]>([]);
    const [testMessage, setTestMessage] = useState('');
    const [chatHistory, setChatHistory] = useState<Message[]>([]);
    const [streamingContent, setStreamingContent] = useState('');
    const wsRef = useRef<WebSocket | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // State: Command Plane
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [reconciliation, setReconciliation] = useState<any>(null);

    // ── Effects ──────────────────────────────────────────────────────
    useEffect(() => {
        fetchTools();
        fetchAgents();
        fetchEmergencyStatus();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            if (activeTab === 'test' && selectedAgentId) fetchMessages();
            if (activeTab === 'observe') { fetchStats(); fetchReconciliation(); }
            if (activeTab === 'govern') fetchTasks();
            fetchEmergencyStatus(); // Always poll safety status
        }, 3000);
        return () => clearInterval(interval);
    }, [activeTab, selectedAgentId]);

    // WebSocket Connection for Agent Thought Streaming
    useEffect(() => {
        if (!selectedAgentId || activeTab !== 'test') return;

        // Connect to the Orchestrator WebSocket (running on port 8080)
        const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?agentId=${selectedAgentId}`);

        ws.onopen = () => console.log('🔌 Connected to Agent Stream');
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'thought_chunk') {
                    setStreamingContent(prev => prev + data.text);
                }
            } catch (e) { console.error('WS Parse Error', e); }
        };
        ws.onclose = () => console.log('🔌 Disconnected from Agent Stream');

        wsRef.current = ws;

        return () => {
            ws.close();
        };
    }, [selectedAgentId, activeTab]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    // ── API Calls ────────────────────────────────────────────────────
    const fetchTools = async () => {
        try {
            const res = await fetch('/api/tools');
            if (res.ok) setTools(await res.json());
            setLoading(false);
        } catch (error) { console.error(error); }
    };

    const fetchAgents = async () => {
        try {
            const res = await fetch('/.well-known/agent.json');
            if (res.ok) {
                const data = await res.json();
                setAgents(data.agents || []);
            }
        } catch (error) { console.error(error); }
    };

    const fetchEmergencyStatus = async () => {
        try {
            const res = await fetch('/api/settings/emergency');
            if (res.ok) {
                const data = await res.json();
                setEmergencyActive(data.active);
            }
        } catch (e) { console.error(e); }
    };

    const toggleEmergency = async () => {
        try {
            const res = await fetch('/api/settings/emergency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !emergencyActive })
            });
            if (res.ok) {
                setEmergencyActive(!emergencyActive);
                if (!emergencyActive) setErrorMessage('🛑 EMERGENCY STOP ACTIVATED');
                else setSuccessMessage('✅ System Resumed');
            }
        } catch (e) { console.error(e); }
    };

    const fetchStats = async () => {
        try {
            const res = await fetch('/api/dashboard/stats');
            if (res.ok) setStats(await res.json());
        } catch (e) { console.error(e); }
    };

    const fetchReconciliation = async () => {
        try {
            const res = await fetch('/api/reports/reconciliation');
            if (res.ok) setReconciliation(await res.json());
        } catch (e) { console.error(e); }
    };

    const fetchTasks = async () => {
        try {
            const res = await fetch('/api/tasks');
            if (res.ok) setTasks(await res.json());
        } catch (e) { console.error(e); }
    };

    const fetchMessages = async () => {
        if (!selectedAgentId) return;
        try {
            const res = await fetch(`/api/agents/${selectedAgentId}/messages`);
            if (res.ok) setChatHistory(await res.json());
        } catch (e) { console.error(e); }
    };

    // ── Handlers ─────────────────────────────────────────────────────
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleToolToggle = (toolId: string) => {
        setFormData(prev => ({
            ...prev,
            tools: prev.tools.includes(toolId) ? prev.tools.filter(id => id !== toolId) : [...prev.tools, toolId],
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const url = editingAgentId
                ? `/api/agents/${editingAgentId}`
                : '/api/agents';
            const method = editingAgentId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (!res.ok) throw new Error('Failed');
            setSuccessMessage(`🎉 Agent ${editingAgentId ? 'updated' : 'deployed'} successfully!`);
            setFormData({ name: '', role: '', goal: '', systemPrompt: '', tools: [] });
            setEditingAgentId(null);
            fetchAgents();
        } catch (err) { setErrorMessage(`Failed to ${editingAgentId ? 'update' : 'deploy'} agent.`); }
        finally { setSubmitting(false); }
    };

    const handleToolSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmittingTool(true);
        try {
            // Parse parameters to ensure it's valid JSON before sending
            let parsedParams = {};
            if (toolFormData.parameters.trim()) {
                parsedParams = JSON.parse(toolFormData.parameters);
            }

            const res = await fetch('/api/tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: toolFormData.name,
                    description: toolFormData.description,
                    parameters: parsedParams
                }),
            });
            if (!res.ok) throw new Error('Failed');
            setSuccessMessage(`🎉 Tool created successfully!`);
            setToolFormData({ name: '', description: '', parameters: '' });
            fetchTools();
        } catch (err) { setErrorMessage('Failed to create tool. Check JSON formatting.'); }
        finally { setSubmittingTool(false); }
    };

    const handleEditClick = (agent: any) => {
        setEditingAgentId(agent.id);
        const agentToolIds = agent.tools?.map((t: any) => t.name) || [];
        setFormData({
            name: agent.name,
            role: agent.role,
            goal: agent.goal,
            systemPrompt: agent.systemPrompt,
            tools: agentToolIds
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteAgent = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this agent? This permanently erases its history and tasks.")) return;
        try {
            const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setSuccessMessage('Agent deleted successfully.');
                if (editingAgentId === id) {
                    setEditingAgentId(null);
                    setFormData({ name: '', role: '', goal: '', systemPrompt: '', tools: [] });
                }
                if (selectedAgentId === id) {
                    setSelectedAgentId('');
                    setChatHistory([]);
                }
                fetchAgents();
            } else {
                setErrorMessage('Failed to delete agent.');
            }
        } catch (e) { setErrorMessage('Failed to delete agent.'); }
    };

    const handleTestSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testMessage.trim() || !selectedAgentId) return;
        const msg = testMessage;
        setTestMessage('');
        setStreamingContent(''); // Reset stream on new message

        // Optimistically add the user message
        setChatHistory(prev => [...prev, {
            id: 'temp-' + Date.now(),
            agentId: selectedAgentId,
            role: 'user',
            content: msg,
            createdAt: new Date().toISOString()
        } as Message]);

        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId: selectedAgentId, message: msg }),
            });
            // Don't fetch immediately, let the webhook/worker do its job
        } catch (err) { setErrorMessage('Failed to send message.'); }
    };

    const handleClearChat = async () => {
        if (!selectedAgentId) return;
        if (!window.confirm("Are you sure you want to clear the chat history for this agent?")) return;
        try {
            const res = await fetch(`/api/agents/${selectedAgentId}/messages`, { method: 'DELETE' });
            if (res.ok) {
                setChatHistory([]);
                setSuccessMessage('Chat history cleared!');
            } else {
                setErrorMessage('Failed to clear chat.');
            }
        } catch (e) { setErrorMessage('Failed to clear chat.'); }
    };

    const handleVote = async (taskId: string, action: 'approve' | 'reject') => {
        try {
            const res = await fetch(`/api/tasks/${taskId}/${action}`, { method: 'POST' });
            if (res.ok) {
                setSuccessMessage(`Task ${action}d!`);
                fetchTasks();
            }
        } catch (e) { setErrorMessage('Action failed'); }
    };

    // ── Render ───────────────────────────────────────────────────────
    if (!currentUserRole) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
                <div className="bg-gray-800/80 backdrop-blur-xl border border-gray-700 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center">
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent mb-2">EGAP</h1>
                    <p className="text-gray-400 mb-8">Select your role to continue</p>

                    <div className="space-y-4">
                        <button
                            onClick={() => { setCurrentUserRole('admin'); setActiveTab('create'); }}
                            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-bold text-white shadow-lg transition-all"
                        >
                            Login as Admin
                        </button>
                        <button
                            onClick={() => { setCurrentUserRole('user'); setActiveTab('test'); }}
                            className="w-full py-4 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-white rounded-xl font-bold shadow-lg transition-all"
                        >
                            Login as User
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen transition-colors duration-500 ${emergencyActive ? 'bg-red-950/30' : 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900'} py-8 px-4 sm:px-6 lg:px-8 text-white`}>
            <div className="max-w-6xl mx-auto">

                {/* Header & Emergency Stop */}
                <div className="flex justify-between items-center mb-10">
                    <div>
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
                            EGAP Command Plane
                        </h1>
                        <p className="mt-2 text-gray-400">Enterprise Grade Agent Platform</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {currentUserRole === 'admin' && (
                            <button
                                onClick={toggleEmergency}
                                className={`px-6 py-3 rounded-xl font-bold border-2 transition-all shadow-xl flex items-center gap-2 ${emergencyActive
                                    ? 'bg-red-600 border-red-400 animate-pulse text-white'
                                    : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-red-500 hover:text-red-400'
                                    }`}
                            >
                                {emergencyActive ? '🛑 EMERGENCY STOP ACTIVE' : '🚨 Emergency Stop'}
                            </button>
                        )}
                        <button
                            onClick={() => setCurrentUserRole(null)}
                            className="px-4 py-3 bg-gray-800 border border-gray-600 text-gray-400 hover:text-white rounded-xl transition-colors text-sm"
                        >
                            Logout ({currentUserRole})
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex justify-center mb-8">
                    <div className="bg-gray-800 p-1 rounded-xl inline-flex space-x-1 overflow-x-auto max-w-full">
                        {(currentUserRole === 'admin' ? [
                            { id: 'create', label: 'Factory' },
                            { id: 'tools', label: 'Tools' },
                            { id: 'test', label: 'Test Flight' },
                            { id: 'govern', label: 'Governance' },
                            { id: 'observe', label: 'Observability' }
                        ] : [
                            { id: 'test', label: 'Test Flight' }
                        ]).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                                    ? 'bg-purple-600 text-white shadow-lg'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Alerts */}
                {successMessage && (
                    <div onClick={() => setSuccessMessage('')} className="mb-6 p-4 bg-green-900/50 border border-green-500 rounded-xl text-green-300 cursor-pointer text-center">
                        {successMessage}
                    </div>
                )}
                {errorMessage && (
                    <div onClick={() => setErrorMessage('')} className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-xl text-red-300 cursor-pointer text-center">
                        {errorMessage}
                    </div>
                )}

                {/* ── TAB: TOOLS ────────────────────────────────────────── */}
                {activeTab === 'tools' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                        {/* List of Existing Tools */}
                        <div className="lg:col-span-1 space-y-4">
                            <h2 className="text-xl font-semibold mb-4 text-gray-300">Registered Tools</h2>
                            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                                {tools.map(tool => (
                                    <div key={tool.id} className="p-4 bg-gray-800/80 border border-gray-700 rounded-xl">
                                        <p className="font-bold text-lg text-white">{tool.name}</p>
                                        <p className="text-sm text-gray-400 mt-1">{tool.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleToolSubmit} className="lg:col-span-2 bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-8 space-y-6 h-fit">
                            <h2 className="text-2xl font-bold mb-4">Create Custom Tool</h2>
                            <p className="text-gray-400 text-sm mb-4">Register a new tool for agents to use. Provide the OpenAPI/JSON schema for parameters.</p>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Function Name</label>
                                <input value={toolFormData.name} onChange={e => setToolFormData({ ...toolFormData, name: e.target.value })} required className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none font-mono text-sm" placeholder="e.g. get_weather" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Description (for the LLM)</label>
                                <input value={toolFormData.description} onChange={e => setToolFormData({ ...toolFormData, description: e.target.value })} required className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Get the current weather for a location" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Parameters Schema (JSON)</label>
                                <textarea value={toolFormData.parameters} onChange={e => setToolFormData({ ...toolFormData, parameters: e.target.value })} required rows={8} className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none font-mono text-xs whitespace-pre" placeholder={`{\n  "type": "OBJECT",\n  "properties": {\n    "location": { "type": "STRING", "description": "City name" }\n  },\n  "required": ["location"]\n}`} />
                            </div>

                            <button type="submit" disabled={submittingTool} className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-bold shadow-lg transition-all">
                                {submittingTool ? 'Registering...' : 'Register Tool'}
                            </button>
                        </form>
                    </div>
                )}

                {/* ── TAB: FACTORY (Create) ─────────────────────────── */}
                {activeTab === 'create' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                        {/* List of Existing Agents */}
                        <div className="lg:col-span-1 space-y-4">
                            <h2 className="text-xl font-semibold mb-4 text-gray-300">Existing Blueprints</h2>
                            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                                {agents.map(agent => (
                                    <div key={agent.id} className={`p-4 bg-gray-800/80 border ${editingAgentId === agent.id ? 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.4)]' : 'border-gray-700'} rounded-xl transition-all group`}>
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="font-bold text-lg text-white">{agent.name}</p>
                                                <p className="text-xs text-gray-400 font-mono">{agent.role}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 mt-4">
                                            <button type="button" onClick={() => handleEditClick(agent)} className="flex-1 py-1.5 bg-blue-900/40 hover:bg-blue-800/60 border border-blue-700/50 text-blue-300 text-sm rounded-lg transition-colors">Edit</button>
                                            <button type="button" onClick={() => handleDeleteAgent(agent.id)} className="flex-1 py-1.5 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 text-red-300 text-sm rounded-lg transition-colors">Delete</button>
                                        </div>
                                    </div>
                                ))}
                                <button type="button" onClick={() => { setEditingAgentId(null); setFormData({ name: '', role: '', goal: '', systemPrompt: '', tools: [] }); }} className="w-full py-4 border-2 border-dashed border-gray-600 hover:border-purple-500 rounded-xl text-gray-400 hover:text-purple-400 transition-colors font-medium">
                                    + Create New Blueprint
                                </button>
                            </div>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="lg:col-span-2 bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-8 space-y-6 h-fit">
                            <h2 className="text-2xl font-bold mb-4">
                                {editingAgentId ? 'Edit Agent Blueprint' : 'Create New Agent Blueprint'}
                            </h2>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                                <input name="name" value={formData.name} onChange={handleInputChange} required className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Agent Name" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
                                <input name="role" value={formData.role} onChange={handleInputChange} required className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" placeholder="e.g. Analyst" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Goal</label>
                                <input name="goal" value={formData.goal} onChange={handleInputChange} required className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Primary Objective" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">System Prompt</label>
                                <textarea name="systemPrompt" value={formData.systemPrompt} onChange={handleInputChange} required rows={4} className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Instructions..." />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-3">Tools</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-40 overflow-y-auto p-2 border border-gray-700 rounded-xl bg-gray-900/30">
                                    {tools.map((tool) => (
                                        <label key={tool.id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border ${formData.tools.includes(tool.id) ? 'bg-purple-900/40 border-purple-500' : 'border-transparent hover:bg-gray-800'}`}>
                                            <input type="checkbox" checked={formData.tools.includes(tool.id)} onChange={() => handleToolToggle(tool.id)} className="accent-purple-500" />
                                            <span className="text-sm font-medium">{tool.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <button type="submit" disabled={submitting} className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-bold shadow-lg transition-all">
                                {submitting ? (editingAgentId ? 'Updating...' : 'Deploying...') : (editingAgentId ? 'Update Agent' : 'Deploy Agent')}
                            </button>
                        </form>
                    </div>
                )}

                {/* ── TAB: TEST FLIGHT ────────────────────────────────── */}
                {activeTab === 'test' && (
                    <div className="max-w-4xl mx-auto bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-6 h-[600px] flex flex-col">
                        <div className="flex gap-4 mb-4">
                            <select value={selectedAgentId} onChange={(e) => { setSelectedAgentId(e.target.value); setChatHistory([]); }} className="flex-1 px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl outline-none">
                                <option value="">Select an Agent...</option>
                                {agents.map(agent => (
                                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                                ))}
                            </select>
                            {selectedAgentId && (
                                <button onClick={handleClearChat} className="px-6 py-3 bg-red-900/50 hover:bg-red-800 border border-red-600 text-red-300 rounded-xl font-bold transition-colors whitespace-nowrap">
                                    Clear Chat
                                </button>
                            )}
                        </div>
                        <div className="flex-1 bg-gray-900/30 rounded-xl p-4 overflow-y-auto space-y-4 border border-gray-700 mb-4">
                            {chatHistory.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] p-3 rounded-xl ${msg.role === 'user' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                                        <p className="text-xs opacity-50 mb-1">{msg.role.toUpperCase()}</p>
                                        <div className="whitespace-pre-wrap">{msg.content}</div>
                                    </div>
                                </div>
                            ))}
                            {/* Streaming Message Indicator */}
                            {chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user' && (
                                <div className="text-left w-full pl-2 fade-in">
                                    <div className="inline-block p-4 max-w-[85%] rounded-2xl bg-gray-800/80 border border-gray-700 shadow-xl overflow-hidden relative group">
                                        <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent"></div>

                                        {/* The actual streamed text */}
                                        {streamingContent ? (
                                            <p className="text-sm whitespace-pre-wrap font-mono text-cyan-300 leading-relaxed tracking-wide">
                                                {streamingContent}
                                                <span className="inline-block w-2 h-4 ml-1 bg-cyan-400 animate-pulse"></span>
                                            </p>
                                        ) : (
                                            <div className="flex space-x-2 items-center h-5">
                                                <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                                <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                                <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></div>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1 font-mono tracking-wider">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                                        Agent Generating...
                                    </p>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                        <form onSubmit={handleTestSend} className="flex gap-2">
                            <input type="text" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} placeholder="Type a message..." className="flex-1 px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-xl outline-none" disabled={!selectedAgentId} />
                            <button type="submit" disabled={!selectedAgentId} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-bold">Send</button>
                        </form>
                    </div>
                )}

                {/* ── TAB: GOVERNANCE ─────────────────────────────────── */}
                {activeTab === 'govern' && (
                    <div className="max-w-5xl mx-auto">
                        <h2 className="text-2xl font-bold mb-6">Pending Approvals (HITL)</h2>
                        <div className="grid gap-4">
                            {tasks.length === 0 ? (
                                <p className="text-gray-500 text-center py-10">No pending tasks requiring approval.</p>
                            ) : (
                                tasks.map(task => (
                                    <div key={task.id} className="bg-gray-800/80 border border-gray-700 rounded-xl p-6 flex justify-between items-center">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="bg-yellow-500/20 text-yellow-300 text-xs px-2 py-1 rounded-full border border-yellow-500/30">PENDING</span>
                                                <span className="text-gray-400 text-sm">{new Date(task.createdAt).toLocaleString()}</span>
                                                <span className="text-purple-400 text-sm font-bold">@{task.agent?.name || 'System'}</span>
                                            </div>
                                            <p className="text-lg">{task.description}</p>
                                        </div>
                                        <div className="flex gap-3">
                                            <button onClick={() => handleVote(task.id, 'reject')} className="px-4 py-2 bg-red-900/50 border border-red-600 text-red-300 rounded-lg hover:bg-red-800 transition-colors">Reject</button>
                                            <button onClick={() => handleVote(task.id, 'approve')} className="px-4 py-2 bg-green-900/50 border border-green-600 text-green-300 rounded-lg hover:bg-green-800 transition-colors">Approve</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* ── TAB: OBSERVABILITY ──────────────────────────────── */}
                {activeTab === 'observe' && stats && (
                    <div className="max-w-6xl mx-auto space-y-8">
                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <div className="bg-gray-800/50 border border-gray-700 p-6 rounded-2xl">
                                <h3 className="text-gray-400 text-sm font-medium">Total Cost (Est.)</h3>
                                <p className="text-4xl font-bold text-green-400 mt-2">${stats.totalCost.toFixed(2)}</p>
                            </div>
                            <div className="bg-gray-800/50 border border-gray-700 p-6 rounded-2xl">
                                <h3 className="text-gray-400 text-sm font-medium">Active Agents</h3>
                                <p className="text-4xl font-bold text-blue-400 mt-2">{stats.activeAgents}</p>
                            </div>
                            <div className="bg-gray-800/50 border border-gray-700 p-6 rounded-2xl">
                                <h3 className="text-gray-400 text-sm font-medium">Pending Tasks</h3>
                                <p className="text-4xl font-bold text-yellow-400 mt-2">{stats.pendingTasks}</p>
                            </div>
                            <div className="bg-gray-800/50 border border-gray-700 p-6 rounded-2xl">
                                <h3 className="text-gray-400 text-sm font-medium">🧟 Zombie Tasks</h3>
                                <p className={`text-4xl font-bold mt-2 ${(stats.zombieCount || 0) > 0 ? 'text-red-400' : 'text-gray-500'}`}>{stats.zombieCount || 0}</p>
                            </div>
                        </div>

                        {/* Trace Map */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6">
                            <h3 className="text-xl font-bold mb-4">Live Trace Map</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-gray-400">
                                    <thead className="bg-gray-900/50 uppercase font-medium text-xs">
                                        <tr>
                                            <th className="px-4 py-3">Time</th>
                                            <th className="px-4 py-3">Service</th>
                                            <th className="px-4 py-3">Operation</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3">Duration</th>
                                            <th className="px-4 py-3">Trace ID</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {stats.traces.length === 0 && (
                                            <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No traces yet. Send a webhook via the Ingress Gateway to generate traces.</td></tr>
                                        )}
                                        {stats.traces.map((trace: any) => (
                                            <tr key={trace.id} className="hover:bg-gray-700/30">
                                                <td className="px-4 py-3">{new Date(trace.startedAt).toLocaleTimeString()}</td>
                                                <td className="px-4 py-3 text-white">{trace.service}</td>
                                                <td className="px-4 py-3">{trace.operation}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded-full text-xs border ${trace.status === 'OK' ? 'bg-green-900/30 border-green-500 text-green-400' : 'bg-red-900/30 border-red-500 text-red-400'
                                                        }`}>
                                                        {trace.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">{trace.durationMs}ms</td>
                                                <td className="px-4 py-3 font-mono text-xs opacity-50">{trace.traceId.substring(0, 8)}...</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Per-Agent Cost Breakdown */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6">
                            <h3 className="text-xl font-bold mb-4">💰 Per-Agent Cost Breakdown</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-gray-400">
                                    <thead className="bg-gray-900/50 uppercase font-medium text-xs">
                                        <tr>
                                            <th className="px-4 py-3">Agent</th>
                                            <th className="px-4 py-3">Invocations</th>
                                            <th className="px-4 py-3">Tokens</th>
                                            <th className="px-4 py-3">Cost (USD)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {(!stats.perAgentCosts || stats.perAgentCosts.length === 0) && (
                                            <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No usage recorded yet. Chat with an agent to generate cost data.</td></tr>
                                        )}
                                        {stats.perAgentCosts?.map((ac: any) => (
                                            <tr key={ac.agentId} className="hover:bg-gray-700/30">
                                                <td className="px-4 py-3 text-white font-medium">{ac.agentName}</td>
                                                <td className="px-4 py-3">{ac.invocations}</td>
                                                <td className="px-4 py-3">{ac.totalTokens.toLocaleString()}</td>
                                                <td className="px-4 py-3 text-green-400 font-mono">${ac.totalCost.toFixed(6)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Reconciliation Report */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6">
                            <h3 className="text-xl font-bold mb-4">📊 Reconciliation Report</h3>
                            {reconciliation ? (
                                <div className="space-y-4">
                                    <p className="text-gray-500 text-xs">Generated: {new Date(reconciliation.generatedAt).toLocaleString()}</p>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-gray-900/60 p-4 rounded-xl text-center">
                                            <p className="text-purple-400 text-2xl font-bold">{reconciliation.summary?.totalIngressEvents ?? 0}</p>
                                            <p className="text-gray-400 text-xs mt-1">Total Ingress</p>
                                        </div>
                                        <div className="bg-gray-900/60 p-4 rounded-xl text-center">
                                            <p className="text-green-400 text-2xl font-bold">{reconciliation.summary?.totalResponses ?? 0}</p>
                                            <p className="text-gray-400 text-xs mt-1">Total Responses</p>
                                        </div>
                                        <div className="bg-gray-900/60 p-4 rounded-xl text-center">
                                            <p className="text-yellow-400 text-2xl font-bold">{reconciliation.summary?.totalTasksCreated ?? 0}</p>
                                            <p className="text-gray-400 text-xs mt-1">HITL Tasks</p>
                                        </div>
                                        <div className="bg-gray-900/60 p-4 rounded-xl text-center">
                                            <p className={`text-2xl font-bold ${(reconciliation.summary?.unresolvedCount ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>{reconciliation.summary?.unresolvedCount ?? 0}</p>
                                            <p className="text-gray-400 text-xs mt-1">Unresolved</p>
                                        </div>
                                    </div>
                                    {reconciliation.taskBreakdown && (
                                        <div className="mt-4 text-sm text-gray-400">
                                            <p>Task Breakdown: <span className="text-yellow-400">{reconciliation.taskBreakdown.pending} Pending</span> · <span className="text-green-400">{reconciliation.taskBreakdown.approved} Approved</span> · <span className="text-blue-400">{reconciliation.taskBreakdown.completed} Completed</span> · <span className="text-red-400">{reconciliation.taskBreakdown.rejected} Rejected</span></p>
                                        </div>
                                    )}
                                    {reconciliation.costSummary && (
                                        <div className="mt-2 text-sm text-gray-400">
                                            <p>Total Tokens: <span className="text-white">{(reconciliation.costSummary.totalTokens || 0).toLocaleString()}</span> · Total Cost: <span className="text-green-400">${(reconciliation.costSummary.totalCost || 0).toFixed(6)}</span></p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-gray-500">Loading reconciliation data...</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
