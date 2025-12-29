import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Brush } from 'recharts';
import { Calendar, Clock, Download, Trash2, RefreshCw, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { socket } from '../App';
import clsx from 'clsx';

interface HistoryRecord {
    _id: string;
    contactId: string;
    platform: 'whatsapp' | 'signal';
    state: string;
    rtt: number;
    threshold?: number;
    timestamp: string;
}

interface HistoryViewProps {
    contactId: string;
    contactName: string;
    platform: 'whatsapp' | 'signal';
    onClose: () => void;
}

interface LastSeenInfo {
    lastSeenOnline: string | null;
    lastActivity: string | null;
    currentState: string | null;
}

export function HistoryView({ contactId, contactName, platform, onClose }: HistoryViewProps) {
    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastSeen, setLastSeen] = useState<LastSeenInfo | null>(null);
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16), // Last 24 hours
        end: new Date().toISOString().slice(0, 16)
    });
    const [limit, setLimit] = useState(1000);
    const [showStats, setShowStats] = useState(true);

    // Fetch last seen info
    useEffect(() => {
        const handleLastSeen = (data: { jid: string } & LastSeenInfo) => {
            if (data.jid === contactId) {
                setLastSeen(data);
            }
        };

        socket.on('last-seen', handleLastSeen);
        socket.emit('get-last-seen', contactId);

        return () => {
            socket.off('last-seen', handleLastSeen);
        };
    }, [contactId]);

    const fetchHistory = () => {
        setLoading(true);
        socket.emit('get-history', {
            jid: contactId,
            limit,
            startDate: new Date(dateRange.start).toISOString(),
            endDate: new Date(dateRange.end).toISOString()
        });
    };

    useEffect(() => {
        const handleHistory = (data: { jid: string; history: HistoryRecord[] }) => {
            if (data.jid === contactId) {
                setHistory(data.history.reverse()); // Oldest first for chart
                setLoading(false);
            }
        };

        socket.on('activity-history', handleHistory);
        fetchHistory();

        return () => {
            socket.off('activity-history', handleHistory);
        };
    }, [contactId]);

    const handleDeleteHistory = () => {
        if (window.confirm('Are you sure you want to delete all history for this contact? This cannot be undone.')) {
            socket.emit('delete-history', contactId);
            setHistory([]);
        }
    };

    const handleExport = () => {
        const csvContent = [
            ['Timestamp', 'State', 'RTT (ms)', 'Threshold (ms)'].join(','),
            ...history.map(r => [
                new Date(r.timestamp).toISOString(),
                r.state,
                r.rtt,
                r.threshold || ''
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activity-history-${contactId.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Calculate statistics
    const stats = React.useMemo(() => {
        if (history.length === 0) return null;

        const onlineCount = history.filter(r => r.state.includes('Online')).length;
        const offlineCount = history.filter(r => r.state === 'OFFLINE').length;
        const standbyCount = history.filter(r => r.state === 'Standby').length;
        const rtts = history.map(r => r.rtt).filter(r => r > 0);
        const avgRtt = rtts.length > 0 ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
        const minRtt = rtts.length > 0 ? Math.min(...rtts) : 0;
        const maxRtt = rtts.length > 0 ? Math.max(...rtts) : 0;

        // Calculate active periods (consecutive online states)
        let activePeriods: { start: Date; end: Date }[] = [];
        let currentPeriodStart: Date | null = null;

        history.forEach((record, idx) => {
            const isActive = record.state.includes('Online');
            if (isActive && !currentPeriodStart) {
                currentPeriodStart = new Date(record.timestamp);
            } else if (!isActive && currentPeriodStart) {
                activePeriods.push({
                    start: currentPeriodStart,
                    end: new Date(history[idx - 1]?.timestamp || record.timestamp)
                });
                currentPeriodStart = null;
            }
        });

        // Close any open period
        if (currentPeriodStart && history.length > 0) {
            activePeriods.push({
                start: currentPeriodStart,
                end: new Date(history[history.length - 1].timestamp)
            });
        }

        const totalActiveTime = activePeriods.reduce((acc, p) => acc + (p.end.getTime() - p.start.getTime()), 0);

        return {
            total: history.length,
            onlineCount,
            offlineCount,
            standbyCount,
            onlinePercent: ((onlineCount / history.length) * 100).toFixed(1),
            avgRtt: avgRtt.toFixed(0),
            minRtt,
            maxRtt,
            totalActiveTime,
            activePeriods
        };
    }, [history]);

    // Format chart data
    const chartData = history.map(r => ({
        timestamp: new Date(r.timestamp).getTime(),
        rtt: r.rtt,
        threshold: r.threshold,
        state: r.state,
        stateValue: r.state.includes('Online') ? 2 : r.state === 'Standby' ? 1 : 0
    }));

    const formatDuration = (ms: number) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Activity className="text-white" size={24} />
                        <div>
                            <h2 className="text-xl font-bold text-white">Activity History</h2>
                            <p className="text-indigo-200 text-sm">{contactName} • {platform}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white text-2xl font-light"
                    >
                        ×
                    </button>
                </div>

                {/* Controls */}
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-gray-500" />
                        <input
                            type="datetime-local"
                            value={dateRange.start}
                            onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        />
                        <span className="text-gray-400">to</span>
                        <input
                            type="datetime-local"
                            value={dateRange.end}
                            onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Limit:</span>
                        <select
                            value={limit}
                            onChange={e => setLimit(Number(e.target.value))}
                            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        >
                            <option value={100}>100</option>
                            <option value={500}>500</option>
                            <option value={1000}>1,000</option>
                            <option value={5000}>5,000</option>
                            <option value={10000}>10,000</option>
                        </select>
                    </div>

                    <button
                        onClick={fetchHistory}
                        disabled={loading}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 text-sm font-medium disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>

                    <div className="flex-1" />

                    <button
                        onClick={handleExport}
                        disabled={history.length === 0}
                        className="px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm font-medium disabled:opacity-50"
                    >
                        <Download size={14} />
                        Export CSV
                    </button>

                    <button
                        onClick={handleDeleteHistory}
                        disabled={history.length === 0}
                        className="px-4 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 text-sm font-medium disabled:opacity-50"
                    >
                        <Trash2 size={14} />
                        Delete All
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
                        </div>
                    ) : history.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                            <Clock size={48} className="mb-4 text-gray-300" />
                            <p className="text-lg font-medium">No history found</p>
                            <p className="text-sm">Try adjusting the date range or start tracking this contact</p>
                        </div>
                    ) : (
                        <>
                            {/* Statistics */}
                            {/* Last Seen Summary */}
                            {lastSeen && (
                                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={clsx(
                                                "w-3 h-3 rounded-full",
                                                lastSeen.currentState?.includes('Online') ? "bg-green-500 animate-pulse" :
                                                lastSeen.currentState === 'Standby' ? "bg-yellow-500" :
                                                lastSeen.currentState === 'OFFLINE' ? "bg-red-500" : "bg-gray-400"
                                            )} />
                                            <div>
                                                <div className="text-sm font-medium text-gray-700">
                                                    Current State: <span className={clsx(
                                                        "font-bold",
                                                        lastSeen.currentState?.includes('Online') ? "text-green-600" :
                                                        lastSeen.currentState === 'Standby' ? "text-yellow-600" :
                                                        lastSeen.currentState === 'OFFLINE' ? "text-red-600" : "text-gray-600"
                                                    )}>{lastSeen.currentState || 'Unknown'}</span>
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Last activity: {lastSeen.lastActivity ? new Date(lastSeen.lastActivity).toLocaleString() : 'Never'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-sm font-medium text-indigo-700">Last Seen Online</div>
                                            <div className="text-lg font-bold text-indigo-900">
                                                {lastSeen.lastSeenOnline ? new Date(lastSeen.lastSeenOnline).toLocaleString() : 'Never'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {stats && (
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <button
                                        onClick={() => setShowStats(!showStats)}
                                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                                    >
                                        <span className="font-medium text-gray-700">Statistics</span>
                                        {showStats ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </button>
                                    
                                    {showStats && (
                                        <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                            <div className="bg-gray-50 rounded-lg p-3">
                                                <div className="text-xs text-gray-500 uppercase">Total Records</div>
                                                <div className="text-2xl font-bold text-gray-900">{stats.total.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-green-50 rounded-lg p-3">
                                                <div className="text-xs text-green-600 uppercase">Online</div>
                                                <div className="text-2xl font-bold text-green-700">{stats.onlinePercent}%</div>
                                                <div className="text-xs text-green-600">{stats.onlineCount} records</div>
                                            </div>
                                            <div className="bg-yellow-50 rounded-lg p-3">
                                                <div className="text-xs text-yellow-600 uppercase">Standby</div>
                                                <div className="text-2xl font-bold text-yellow-700">{stats.standbyCount}</div>
                                            </div>
                                            <div className="bg-red-50 rounded-lg p-3">
                                                <div className="text-xs text-red-600 uppercase">Offline</div>
                                                <div className="text-2xl font-bold text-red-700">{stats.offlineCount}</div>
                                            </div>
                                            <div className="bg-blue-50 rounded-lg p-3">
                                                <div className="text-xs text-blue-600 uppercase">Avg RTT</div>
                                                <div className="text-2xl font-bold text-blue-700">{stats.avgRtt} ms</div>
                                                <div className="text-xs text-blue-600">{stats.minRtt}-{stats.maxRtt} ms</div>
                                            </div>
                                            <div className="bg-purple-50 rounded-lg p-3">
                                                <div className="text-xs text-purple-600 uppercase">Active Time</div>
                                                <div className="text-2xl font-bold text-purple-700">{formatDuration(stats.totalActiveTime)}</div>
                                                <div className="text-xs text-purple-600">{stats.activePeriods.length} sessions</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* RTT Chart */}
                            <div className="bg-white rounded-xl border border-gray-200 p-4">
                                <h3 className="font-medium text-gray-700 mb-4">RTT Over Time</h3>
                                <div className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis
                                                dataKey="timestamp"
                                                type="number"
                                                domain={['dataMin', 'dataMax']}
                                                tickFormatter={(t) => new Date(t).toLocaleTimeString()}
                                                tick={{ fontSize: 11 }}
                                            />
                                            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                                            <Tooltip
                                                labelFormatter={(t: number) => new Date(t).toLocaleString()}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(value: number, name: string) => [
                                                    `${value} ms`,
                                                    name === 'rtt' ? 'RTT' : 'Threshold'
                                                ]}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="rtt"
                                                stroke="#3b82f6"
                                                strokeWidth={1.5}
                                                dot={false}
                                                name="rtt"
                                                isAnimationActive={false}
                                            />
                                            <Line
                                                type="step"
                                                dataKey="threshold"
                                                stroke="#ef4444"
                                                strokeDasharray="5 5"
                                                strokeWidth={1.5}
                                                dot={false}
                                                name="threshold"
                                                isAnimationActive={false}
                                            />
                                            <Brush
                                                dataKey="timestamp"
                                                height={30}
                                                stroke="#8884d8"
                                                tickFormatter={(t) => new Date(t).toLocaleTimeString()}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* State Timeline */}
                            <div className="bg-white rounded-xl border border-gray-200 p-4">
                                <h3 className="font-medium text-gray-700 mb-4">Activity Timeline</h3>
                                <div className="h-[120px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis
                                                dataKey="timestamp"
                                                type="number"
                                                domain={['dataMin', 'dataMax']}
                                                tickFormatter={(t) => new Date(t).toLocaleTimeString()}
                                                tick={{ fontSize: 11 }}
                                            />
                                            <YAxis
                                                domain={[0, 2]}
                                                ticks={[0, 1, 2]}
                                                tickFormatter={(v) => v === 2 ? 'Online' : v === 1 ? 'Standby' : 'Offline'}
                                                tick={{ fontSize: 11 }}
                                                width={60}
                                            />
                                            <Tooltip
                                                labelFormatter={(t: number) => new Date(t).toLocaleString()}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(value: number, name: string, props: any) => [
                                                    props.payload.state,
                                                    'State'
                                                ]}
                                            />
                                            <ReferenceLine y={2} stroke="#22c55e" strokeDasharray="3 3" />
                                            <ReferenceLine y={1} stroke="#eab308" strokeDasharray="3 3" />
                                            <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
                                            <Line
                                                type="stepAfter"
                                                dataKey="stateValue"
                                                stroke="#6366f1"
                                                strokeWidth={2}
                                                dot={false}
                                                isAnimationActive={false}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Recent Activity Table */}
                            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                                    <h3 className="font-medium text-gray-700">Recent Activity (Last 50)</h3>
                                </div>
                                <div className="overflow-auto max-h-[300px]">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-2 text-left font-medium text-gray-600">Time</th>
                                                <th className="px-4 py-2 text-left font-medium text-gray-600">State</th>
                                                <th className="px-4 py-2 text-left font-medium text-gray-600">RTT</th>
                                                <th className="px-4 py-2 text-left font-medium text-gray-600">Threshold</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {history.slice(-50).reverse().map((record, idx) => (
                                                <tr key={record._id || idx} className="border-t border-gray-100 hover:bg-gray-50">
                                                    <td className="px-4 py-2 text-gray-600">
                                                        {new Date(record.timestamp).toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <span className={clsx(
                                                            "px-2 py-0.5 rounded text-xs font-medium",
                                                            record.state.includes('Online') ? "bg-green-100 text-green-700" :
                                                                record.state === 'Standby' ? "bg-yellow-100 text-yellow-700" :
                                                                    record.state === 'OFFLINE' ? "bg-red-100 text-red-700" :
                                                                        "bg-gray-100 text-gray-700"
                                                        )}>
                                                            {record.state}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-gray-600">{record.rtt} ms</td>
                                                    <td className="px-4 py-2 text-gray-600">{record.threshold || '-'} ms</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

