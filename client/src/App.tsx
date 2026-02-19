
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
    traces: any[];
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
    const [activeTab, setActiveTab] = useState<'create' | 'test' | 'govern' | 'observe'>('create');
    const [loading, setLoading] = useState(true);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // State: Emergency Stop
    const [emergencyActive, setEmergencyActive] = useState(false);

    // State: Create Agent
    const [tools, setTools] = useState<Tool[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [formData, setFormData] = useState<AgentFormData>({
        name: '', role: '', goal: '', systemPrompt: '', tools: [],
    });

    // State: Test Flight
    const [selectedAgentId, setSelectedAgentId] = useState<string>('');
    const [agents, setAgents] = useState<any[]>([]);
    const [testMessage, setTestMessage] = useState('');
    const [chatHistory, setChatHistory] = useState<Message[]>([]);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // State: Command Plane
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [tasks, setTasks] = useState<Task[]>([]);

    // ── Effects ──────────────────────────────────────────────────────
    useEffect(() => {
        fetchTools();
        fetchAgents();
        fetchEmergencyStatus();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            if (activeTab === 'test' && selectedAgentId) fetchMessages();
            if (activeTab === 'observe') fetchStats();
            if (activeTab === 'govern') fetchTasks();
            fetchEmergencyStatus(); // Always poll safety status
        }, 3000);
        return () => clearInterval(interval);
    }, [activeTab, selectedAgentId]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    // ── API Calls ────────────────────────────────────────────────────
    const fetchTools = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/tools');
            if (res.ok) setTools(await res.json());
            setLoading(false);
        } catch (error) { console.error(error); }
    };

    const fetchAgents = async () => {
        try {
            const res = await fetch('http://localhost:3000/.well-known/agent.json');
            if (res.ok) {
                const data = await res.json();
                setAgents(data.agents || []);
            }
        } catch (error) { console.error(error); }
    };

    const fetchEmergencyStatus = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/settings/emergency');
            if (res.ok) {
                const data = await res.json();
                setEmergencyActive(data.active);
            }
        } catch (e) { console.error(e); }
    };

    const toggleEmergency = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/settings/emergency', {
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
            const res = await fetch('http://localhost:3000/api/dashboard/stats');
            if (res.ok) setStats(await res.json());
        } catch (e) { console.error(e); }
    };

    const fetchTasks = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/tasks');
            if (res.ok) setTasks(await res.json());
        } catch (e) { console.error(e); }
    };

    const fetchMessages = async () => {
        if (!selectedAgentId) return;
        try {
            const res = await fetch(`http://localhost:3000/api/agents/${selectedAgentId}/messages`);
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
            const res = await fetch('http://localhost:3000/api/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (!res.ok) throw new Error('Failed');
            setSuccessMessage('🎉 Agent deployed successfully!');
            setFormData({ name: '', role: '', goal: '', systemPrompt: '', tools: [] });
            fetchAgents();
        } catch (err) { setErrorMessage('Failed to deploy agent.'); }
        finally { setSubmitting(false); }
    };

    const handleTestSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testMessage.trim() || !selectedAgentId) return;
        const msg = testMessage;
        setTestMessage('');
        try {
            await fetch('http://localhost:3000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId: selectedAgentId, message: msg }),
            });
            fetchMessages();
        } catch (err) { setErrorMessage('Failed to send message.'); }
    };

    const handleVote = async (taskId: string, action: 'approve' | 'reject') => {
        try {
            const res = await fetch(`http://localhost:3000/api/tasks/${taskId}/${action}`, { method: 'POST' });
            if (res.ok) {
                setSuccessMessage(`Task ${action}d!`);
                fetchTasks();
            }
        } catch (e) { setErrorMessage('Action failed'); }
    };

    // ── Render ───────────────────────────────────────────────────────
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
                    <button
                        onClick={toggleEmergency}
                        className={`px-6 py-3 rounded-xl font-bold border-2 transition-all shadow-xl flex items-center gap-2 ${emergencyActive
                                ? 'bg-red-600 border-red-400 animate-pulse text-white'
                                : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-red-500 hover:text-red-400'
                            }`}
                    >
                        {emergencyActive ? '🛑 EMERGENCY STOP ACTIVE' : '🚨 Emergency Stop'}
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex justify-center mb-8">
                    <div className="bg-gray-800 p-1 rounded-xl inline-flex space-x-1">
                        {[
                            { id: 'create', label: 'Factory' },
                            { id: 'test', label: 'Test Flight' },
                            { id: 'govern', label: 'Governance' },
                            { id: 'observe', label: 'Observability' }
                        ].map(tab => (
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

                {/* ── TAB: FACTORY (Create) ─────────────────────────── */}
                {activeTab === 'create' && (
                    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl p-8 space-y-6">
                        <h2 className="text-xl font-semibold mb-4">Create New Agent Blueprint</h2>

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
                            {submitting ? 'Deploying...' : 'Deploy Agent'}
                        </button>
                    </form>
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
