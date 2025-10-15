import { useState, useEffect } from 'react';
import { getActor, verifyCertificate, verifyDataHash, getErrorMessage, shouldRefreshData } from './actor';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const [networkStats, setNetworkStats] = useState(null);
  const [subnets, setSubnets] = useState([]);
  const [selectedSubnet, setSelectedSubnet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actor, setActor] = useState(null);
  const [fetchProgress, setFetchProgress] = useState('');
  const [certificateVerified, setCertificateVerified] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [nextRefreshTime, setNextRefreshTime] = useState(null);

  // Initialize actor
  useEffect(() => {
    getActor()
      .then(setActor)
      .catch(err => {
        console.error("Failed to create actor:", err);
        setError("Failed to initialize connection: " + getErrorMessage(err));
        setLoading(false);
      });
  }, []);

  // Load initial data
  useEffect(() => {
    if (actor) {
      loadData();
    }
  }, [actor]);

  // Check refresh availability periodically
  useEffect(() => {
    if (!actor) return;
    
    const interval = setInterval(async () => {
      try {
        const freshness = await actor.getDataFreshness();
        setCanRefresh(freshness.canRefresh);
        setNextRefreshTime(Number(freshness.nextRefreshAvailable));
      } catch (err) {
        console.error("Failed to check refresh status:", err);
      }
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(interval);
  }, [actor]);

  const loadData = async () => {
    if (!actor) return;
    
    setLoading(true);
    setError(null);
    setFetchProgress('Loading cached data from canister...');
    
    try {
      // Get data with certificate for verification
      const certifiedData = await actor.getStatsWithCertificate();
      
      if ('ok' in certifiedData.stats && certifiedData.stats.ok) {
        const stats = certifiedData.stats.ok;
        setNetworkStats(stats);
        
        // Verify certificate
        const canisterId = import.meta.env.VITE_CANISTER_ID_SWISS_SUBNET_BACKEND;
        const isVerified = await verifyCertificate(certifiedData, canisterId);
        setCertificateVerified(isVerified);
        
        if (isVerified) {
          console.log("✅ Certificate verified - data is tamper-proof");
          setFetchProgress('✓ Data loaded and verified!');
        } else {
          console.warn("⚠️ Certificate verification failed");
          setFetchProgress('⚠ Data loaded but not verified');
        }
        
        // Load subnets
        const subnetsData = await actor.getSubnets();
        setSubnets(subnetsData);
        
        // Check freshness
        const freshness = await actor.getDataFreshness();
        setCanRefresh(freshness.canRefresh);
        setNextRefreshTime(Number(freshness.nextRefreshAvailable));
        
        if (freshness.isStale) {
          setFetchProgress('⚠ Cached data is stale. Consider refreshing.');
        }
        
        setTimeout(() => setFetchProgress(''), 3000);
      } else {
        // No cached data
        setFetchProgress('No cached data found, fetching fresh data...');
        await fetchFreshData();
      }
    } catch (err) {
      console.error('Error loading data:', err);
      const errorMsg = getErrorMessage(err);
      setError(`Failed to load data: ${errorMsg}`);
      
      // Try to fetch fresh data as fallback
      try {
        await fetchFreshData();
      } catch (refreshErr) {
        console.error('Also failed to refresh:', refreshErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchFreshData = async () => {
    if (!actor) return;
    
    setRefreshing(true);
    setError(null);
    
    try {
      // Check if we can refresh
      const freshness = await actor.getDataFreshness();
      console.log("Freshness check:", freshness);
      
      if (!freshness.canRefresh) {
        const now = Date.now() * 1000000; // Convert to nanoseconds
        const nextRefreshNs = Number(freshness.nextRefreshAvailable);
        const waitNs = nextRefreshNs - now;
        const waitMinutes = Math.ceil(waitNs / 60000000000);
        
        if (waitMinutes > 0) {
          throw new Error(`Rate limited: Please wait ${waitMinutes} more minutes before refreshing`);
        }
        // If waitMinutes is 0 or negative, allow the refresh
      }
      
      setFetchProgress('🔄 Refreshing data from IC network...');
      
      const refreshResult = await actor.refreshNetworkData();
      console.log("Refresh result:", refreshResult);
      
      if ('ok' in refreshResult && refreshResult.ok) {
        setFetchProgress('✓ Data refreshed successfully!');
        
        // Fetch updated certified stats
        const certifiedData = await actor.getStatsWithCertificate();
        if ('ok' in certifiedData.stats && certifiedData.stats.ok) {
          setNetworkStats(certifiedData.stats.ok);
          
          // Verify certificate
          const canisterId = import.meta.env.VITE_CANISTER_ID_SWISS_SUBNET_BACKEND;
          const isVerified = await verifyCertificate(certifiedData, canisterId);
          setCertificateVerified(isVerified);
        }
        
        // Fetch updated subnets
        const subnetsData = await actor.getSubnets();
        setSubnets(subnetsData);
        
        // Update refresh status
        const newFreshness = await actor.getDataFreshness();
        setCanRefresh(newFreshness.canRefresh);
        setNextRefreshTime(Number(newFreshness.nextRefreshAvailable));
        
        setTimeout(() => setFetchProgress(''), 3000);
      } else {
        const errorMsg = refreshResult.err || 'Unknown error';
        throw new Error(errorMsg);
      }
    } catch (err) {
      console.error('Error refreshing data:', err);
      const errorMsg = getErrorMessage(err);
      setError(`Failed to refresh data: ${errorMsg}`);
      setFetchProgress('');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    if (canRefresh) {
      fetchFreshData();
    }
  };

  const handleSubnetClick = (subnet) => {
    setSelectedSubnet(subnet);
  };

  const pieData = networkStats ? [
    { name: 'Gen1', value: Number(networkStats.totalGen1), color: '#8b5cf6' },
    { name: 'Gen2', value: Number(networkStats.totalGen2), color: '#06b6d4' },
  ] : [];

  const barData = subnets
    .sort((a, b) => b.nodeCount - a.nodeCount)
    .slice(0, 10)
    .map((subnet, index) => ({
      name: `Subnet ${index + 1}`,
      Gen1: Number(subnet.gen1Count),
      Gen2: Number(subnet.gen2Count),
    }));

  if (loading) {
    return (
      <div className="loading-screen">
        <h2 className="loading-title">Loading Dashboard...</h2>
        <p className="loading-progress">Connecting to Internet Computer</p>
      </div>
    );
  }

  if (error && !networkStats) {
    return (
      <div className="error-screen">
        <p className="error-message">{error}</p>
        <button onClick={loadData} className="retry-button">Retry</button>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-content">
        <div className="header">
          <h1 className="header-title">ICP Subnet Dashboard</h1>
          <p className="header-subtitle">Real-time view of ICP network topology and node distribution</p>
          {certificateVerified ? (
            <div className="certificate-banner">
              🔒 Data verified with IC certificate - cryptographically tamper-proof
            </div>
          ) : (
            <div className="error-banner">
              ⚠️ Certificate verification unavailable - using unverified data
            </div>
          )}
          {error && (
            <div className="error-banner">
              ⚠️ {error}
            </div>
          )}
          <div className="header-controls">
            <button
              onClick={handleRefresh}
              disabled={refreshing || !canRefresh}
              className="refresh-button"
              title={!canRefresh ? 'Rate limited - please wait' : 'Refresh data from IC network'}
            >
              {refreshing ? '🔄 Refreshing...' : canRefresh ? '🔄 Refresh Data' : '⏱️ Rate Limited'}
            </button>
            {networkStats && (
              <FreshnessIndicator 
                timestamp={networkStats.lastUpdated}
                canRefresh={canRefresh}
                nextRefreshTime={nextRefreshTime}
              />
            )}
            {fetchProgress && (
              <span className="progress-text">{fetchProgress}</span>
            )}
          </div>
        </div>

        {/* Network Stats Cards */}
        {networkStats && (
          <div className="stats-grid">
            <StatsCard 
              title="Total Subnets" 
              value={networkStats.totalSubnets.toString()} 
              color="#06b6d4" 
              icon="🔗" 
            />
            <StatsCard 
              title="Total Nodes" 
              value={networkStats.totalNodes.toString()} 
              color="#06b6d4" 
              icon="🖥️" 
            />
            <StatsCard 
              title="Gen1 Nodes" 
              value={networkStats.totalGen1.toString()} 
              color="#8b5cf6" 
              icon="📦" 
            />
            <StatsCard 
              title="Gen2 Nodes" 
              value={networkStats.totalGen2.toString()} 
              color="#10b981" 
              icon="⚡" 
            />
          </div>
        )}

        {/* Charts Row */}
        <div className="charts-grid">
          {/* Pie Chart */}
          <ChartCard title="📊 Node Generation Distribution">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    background: '#1e293b', 
                    border: 'none', 
                    borderRadius: '8px',
                    color: 'white'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Bar Chart */}
          <ChartCard title="📈 Top 10 Subnets by Node Count">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData}>
                <XAxis 
                  dataKey="name" 
                  stroke="#9ca3af" 
                  fontSize={12}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="#9ca3af" />
                <Tooltip 
                  contentStyle={{ 
                    background: '#1e293b', 
                    border: 'none', 
                    borderRadius: '8px',
                    color: 'white'
                  }}
                />
                <Legend />
                <Bar dataKey="Gen1" stackId="a" fill="#8b5cf6" />
                <Bar dataKey="Gen2" stackId="a" fill="#06b6d4" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Subnets List */}
        <div className="subnets-section">
          <h2 className="subnets-title">
            🔗 All Subnets ({subnets.length})
          </h2>
          <div className="subnets-grid">
            {subnets.map((subnet, index) => (
              <button
                key={index}
                onClick={() => handleSubnetClick(subnet)}
                className={`subnet-card ${selectedSubnet === subnet ? 'selected' : ''}`}
              >
                <div className="subnet-id">
                  {subnet.subnetId.substring(0, 20)}...
                </div>
                <div className="subnet-stats">
                  <span className="subnet-gen1">Gen1: {subnet.gen1Count.toString()}</span>
                  <span className="subnet-gen2">Gen2: {subnet.gen2Count.toString()}</span>
                </div>
                <div className="subnet-total">
                  Total: {subnet.nodeCount.toString()} nodes
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Subnet Details */}
        {selectedSubnet && (
          <div className="details-section">
            <h2 className="details-title">📋 Subnet Details</h2>
            <div className="details-subnet-id">
              <span className="details-subnet-label">Subnet ID:</span>
              <span className="details-subnet-value">
                {selectedSubnet.subnetId}
              </span>
            </div>
            <div className="details-stats-grid">
              <div>
                <div className="details-stat-label">Total Nodes</div>
                <div className="details-stat-value">
                  {selectedSubnet.nodeCount.toString()}
                </div>
              </div>
              <div>
                <div className="details-stat-label subnet-gen1">Gen1 Nodes</div>
                <div className="details-stat-value">
                  {selectedSubnet.gen1Count.toString()}
                </div>
              </div>
              <div>
                <div className="details-stat-label subnet-gen2">Gen2 Nodes</div>
                <div className="details-stat-value">
                  {selectedSubnet.gen2Count.toString()}
                </div>
              </div>
            </div>
            <h3 className="details-nodes-title">
              🖥️ Node List ({selectedSubnet.nodes.length})
            </h3>
            <div className="nodes-grid">
              {selectedSubnet.nodes.map((node, index) => (
                <div key={index} className="node-card">
                  <div className="node-id" title={node.nodeId}>
                    {node.nodeId.substring(0, 15)}...
                  </div>
                  <div className={`node-badge ${'Gen1' in node.generation ? 'gen1' : 'gen2'}`}>
                    {'Gen1' in node.generation ? '📦 Gen1' : '⚡ Gen2'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          <p>Built on the Internet Computer Protocol 🚀</p>
          <p>
            Last updated: {networkStats ? new Date(Number(networkStats.lastUpdated) / 1000000).toLocaleString() : 'N/A'}
          </p>
          <p className="footer-small">
            {certificateVerified ? '✓ Using certified on-chain data' : '⚠ Unverified data'} | Data source: IC Management Canister
          </p>
        </div>
      </div>
    </div>
  );
}

function FreshnessIndicator({ timestamp, canRefresh, nextRefreshTime }) {
  const [ageText, setAgeText] = useState('');
  const [refreshText, setRefreshText] = useState('');
  
  useEffect(() => {
    const updateAge = () => {
      if (!timestamp) {
        setAgeText('Never');
        return;
      }
      
      const now = Date.now();
      const lastUpdate = Number(timestamp) / 1000000;
      const ageMs = now - lastUpdate;
      const ageMinutes = Math.floor(ageMs / 60000);
      
      if (ageMinutes < 1) {
        setAgeText('Just now');
      } else if (ageMinutes < 60) {
        setAgeText(`${ageMinutes} min ago`);
      } else {
        const ageHours = Math.floor(ageMinutes / 60);
        setAgeText(`${ageHours} hour${ageHours > 1 ? 's' : ''} ago`);
      }
      
      // Update refresh availability text
      if (!canRefresh && nextRefreshTime) {
        const nextRefreshMs = Number(nextRefreshTime) / 1000000;
        const waitMs = nextRefreshMs - now;
        const waitMinutes = Math.ceil(waitMs / 60000);
        if (waitMinutes > 0) {
          setRefreshText(` (refresh in ${waitMinutes} min)`);
        } else {
          setRefreshText('');
        }
      } else {
        setRefreshText('');
      }
    };
    
    updateAge();
    const interval = setInterval(updateAge, 10000); // Update every 10 seconds
    
    return () => clearInterval(interval);
  }, [timestamp, canRefresh, nextRefreshTime]);
  
  return (
    <span style={{ 
      color: '#9ca3af', 
      fontSize: '14px',
      fontStyle: 'italic'
    }}>
      Data age: {ageText}{refreshText}
    </span>
  );
}

function StatsCard({ title, value, color, icon }) {
  return (
    <div className="stats-card">
      <div className="stats-icon">{icon}</div>
      <div className="stats-title" style={{ color: color }}>
        {title}
      </div>
      <div className="stats-value">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      {children}
    </div>
  );
}

export default App;