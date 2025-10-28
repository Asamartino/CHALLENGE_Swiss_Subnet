import { useState, useEffect } from 'react';
import { getActor, getErrorMessage, formatTimestamp, verifyCertificate } from './actor';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const [networkStats, setNetworkStats] = useState(null);
  const [subnets, setSubnets] = useState([]);
  const [selectedSubnet, setSelectedSubnet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actor, setActor] = useState(null);
  const [message, setMessage] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [certificateStatus, setCertificateStatus] = useState(null);

  useEffect(() => {
    const initActor = async () => {
      try {
        const actorInstance = await getActor();
        setActor(actorInstance);
        setInitialized(true);
        setMessage('Connected to canister');
      } catch (err) {
        console.error("Failed to create actor:", err);
        setError("Failed to initialize: " + getErrorMessage(err));
      }
    };
    
    initActor();
  }, []);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setUploadFile(file);
    setMessage(`Selected: ${file.name}`);
  };

  // Clear all data function
  const handleClearData = async () => {
    if (!actor) return;
    
    setLoading(true);
    setError(null);
    
    try {
      await actor.refreshData();
      setNetworkStats(null);
      setSubnets([]);
      setSelectedSubnet(null);
      setCertificateStatus(null);
      setMessage('✅ All data cleared successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error('Error clearing data:', err);
      setError('Failed to clear data: ' + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUploadNodes = async () => {
    if (!actor) {
      setError('Actor not initialized. Please refresh the page.');
      return;
    }
    
    if (!uploadFile) {
      setError('Please select a JSON file first');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Only show clearing message if data exists
      if (networkStats) {
        setMessage('Clearing old data...');
        await actor.refreshData();
        setNetworkStats(null);
        setSubnets([]);
        setSelectedSubnet(null);
      } else {
        // First time upload - just clear backend silently
        await actor.refreshData();
      }
      
      setMessage('Reading and processing file...');
      
      const fileText = await uploadFile.text();
      const parsedData = JSON.parse(fileText);
      
      // Get nodes array from either format
      const nodes = parsedData.nodes || parsedData;
      
      // Convert all fields to strings (no nulls)
      const processedNodes = nodes
        .filter(node => node.subnet_id) // Only nodes with subnet_id
        .map(node => ({
          node_id: node.node_id || "",
          node_hardware_generation: node.node_hardware_generation || "",
          node_operator_id: node.node_operator_id || "", 
          node_provider_id: node.node_provider_id || "",
          dc_id: node.dc_id || "",
          region: node.region || "",
          status: node.status || "",
          subnet_id: node.subnet_id || ""
        }));
      
      console.log(`Processing ${processedNodes.length} nodes`);
      console.log("Sample node:", processedNodes[0]);
      
      setMessage(`Uploading ${processedNodes.length} nodes...`);
      
      const result = await actor.loadNodesFromFile(processedNodes);
      
      if (result && 'ok' in result) {
        setMessage(result.ok);
        await loadDashboardData();
      } else if (result && 'err' in result) {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error:', err);
      setError('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async () => {
    if (!actor) return;
    
    setLoading(true);
    setError(null);
    setCertificateStatus(null);
    
    try {
      // Try certified query first
      let certifiedData = null;
      let certificateValid = false;
      
      console.log("🔍 Attempting to fetch certified data...");
      
      try {
        certifiedData = await actor.getNetworkStatsCertified();
        console.log("📊 Certified data received:", certifiedData);
        
        if (certifiedData.certificate && certifiedData.certificate.length > 0 && certifiedData.certificate[0]) {
          console.log("🔐 Certificate found, verifying...");
          const canisterId = import.meta.env.VITE_CANISTER_ID_SWISS_SUBNET_BACKEND;
          certificateValid = await verifyCertificate(certifiedData, canisterId);
          
          if (certificateValid) {
            console.log("✅ CERTIFICATE VERIFIED!");
            setCertificateStatus('verified');
            setMessage('✅ Data cryptographically verified by Internet Computer');
            setNetworkStats(certifiedData.stats);
          } else {
            console.warn("⚠️ Certificate verification failed");
            setCertificateStatus('invalid');
            setMessage('⚠️ Certificate verification failed - using unverified data');
            const stats = await actor.getNetworkStats();
            setNetworkStats(stats);
          }
        } else {
          console.warn("⚠️ No certificate in response");
          setCertificateStatus('missing');
          setMessage('⚠️ No certificate available - using unverified data');
          setNetworkStats(certifiedData.stats);
        }
      } catch (certErr) {
        console.warn("Certified query failed, falling back to regular query:", certErr);
        setCertificateStatus('unavailable');
        setMessage('⚠️ Certified query unavailable - using regular query');
        const stats = await actor.getNetworkStats();
        setNetworkStats(stats);
      }
      
      // Load subnets
      const subnetsData = await actor.getSubnets();
      const sortedSubnets = subnetsData.sort((a, b) => 
        Number(b.nodeCount) - Number(a.nodeCount)
      );
      setSubnets(sortedSubnets);
      
      // Clear message after delay if not certificate status
      if (!certificateValid) {
        setTimeout(() => setMessage(''), 5000);
      }
      
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load: ' + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubnetClick = async (subnet) => {
    if (!actor) return;
    
    try {
      const result = await actor.getSubnetById(subnet.subnetId);
      if (result && 'ok' in result) {
        setSelectedSubnet(result.ok);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  if (!initialized) {
    return (
      <div className="loading-screen">
        <div className="loading-title">Connecting to Internet Computer</div>
        <div className="loading-progress">Initializing...</div>
      </div>
    );
  }

  const pieData = networkStats ? [
    { name: 'Gen1', value: Number(networkStats.gen1Nodes), color: '#8b5cf6' },
    { name: 'Gen2', value: Number(networkStats.gen2Nodes), color: '#06b6d4' },
    { name: 'Unknown', value: Number(networkStats.unknownNodes), color: '#6b7280' },
  ].filter(item => item.value > 0) : [];

  const subnetChartData = subnets.slice(0, 10).map(subnet => ({
    name: subnet.subnetId.substring(0, 8) + '...',
    Gen1: Number(subnet.gen1Count),
    Gen2: Number(subnet.gen2Count),
  }));

  return (
    <div className="app-container">
      <div className="app-content">
        <div className="header">
          <h1 className="header-title">ICP Subnet Dashboard</h1>
          <p className="header-subtitle">Real-time view of Internet Computer subnets</p>
          
          <div className="status-container">
            {error && <div className="error-banner">{error}</div>}
            
            {/* Certificate Status Banner */}
            {certificateStatus === 'verified' && (
              <div className="certificate-banner">
                ✅ Data cryptographically verified by Internet Computer
              </div>
            )}
            
            {certificateStatus === 'invalid' && (
              <div className="warning-banner">
                ⚠️ Certificate verification failed - using unverified data
              </div>
            )}
            
            {certificateStatus === 'missing' && (
              <div className="warning-banner">
                ⚠️ No certificate available - backend may need redeployment
              </div>
            )}
            
            {certificateStatus === 'unavailable' && (
              <div className="warning-banner">
                ⚠️ Certified query not available - using regular query
              </div>
            )}
            
            {/* Regular messages */}
            {message && !error && !certificateStatus && (
              <div className="classification-banner">{message}</div>
            )}
          </div>

          <div className="header-controls">
            <input type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} id="file-upload" />
            <label htmlFor="file-upload" className="refresh-button" style={{ cursor: 'pointer' }}>
              Select JSON File
            </label>
            
            <button className="refresh-button" onClick={handleUploadNodes} disabled={loading || !uploadFile}>
              {loading ? 'Processing...' : 'Upload & Process Data'}
            </button>

            {networkStats && (
              <button 
                className="refresh-button" 
                onClick={handleClearData} 
                disabled={loading}
                style={{ background: '#ef4444' }}
              >
                {loading ? 'Clearing...' : 'Clear All Data'}
              </button>
            )}
          </div>
        </div>

        {networkStats && (
          <>
            <div className="stats-grid">
              <StatsCard title="Subnets" value={networkStats.totalSubnets.toString()} color="#93c5fd" icon="🔗" />
              <StatsCard title="Nodes" value={networkStats.totalNodes.toString()} color="#93c5fd" icon="🖥️" />
              <StatsCard 
                title="Gen1" 
                value={networkStats.gen1Nodes.toString()} 
                color="#c084fc" 
                icon="📦"
                percentage={networkStats.totalNodes > 0 ? ((Number(networkStats.gen1Nodes) / Number(networkStats.totalNodes)) * 100).toFixed(1) : 0}
              />
              <StatsCard 
                title="Gen2" 
                value={networkStats.gen2Nodes.toString()} 
                color="#06b6d4" 
                icon="⚡"
                percentage={networkStats.totalNodes > 0 ? ((Number(networkStats.gen2Nodes) / Number(networkStats.totalNodes)) * 100).toFixed(1) : 0}
              />
              <StatsCard 
                title="Unknown" 
                value={networkStats.unknownNodes.toString()} 
                color="#6b7280" 
                icon="❓"
                percentage={networkStats.totalNodes > 0 ? ((Number(networkStats.unknownNodes) / Number(networkStats.totalNodes)) * 100).toFixed(1) : 0}
              />
            </div>

            <div className="charts-grid">
              <ChartCard title="Node Distribution">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} fill="#8884d8" dataKey="value"
                         label={(entry) => `${entry.name}: ${entry.value}`}>
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div className="subnets-section">
              <h2 className="subnets-title">Subnets ({subnets.length})</h2>
              <div className="subnets-grid">
                {subnets.map((subnet, index) => (
                  <button key={index} onClick={() => handleSubnetClick(subnet)}
                    className={`subnet-card ${selectedSubnet?.subnetId === subnet.subnetId ? 'selected' : ''}`}>
                    
                    {/* Subnet ID - selectable for copying */}
                    <div 
                      className="subnet-id-selectable" 
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginBottom: '8px' }}
                    >
                      {subnet.subnetId}
                    </div>
                    
                    {/* Node counts */}
                    <div className="subnet-stats">
                      <span className="subnet-gen1">Gen1: {subnet.gen1Count.toString()}</span>
                      <span className="subnet-gen2">Gen2: {subnet.gen2Count.toString()}</span>
                      <span style={{ color: '#9ca3af', fontWeight: 600 }}>Unknown: {subnet.unknownCount.toString()}</span>
                    </div>
                    <div className="subnet-total">Total: {subnet.nodeCount.toString()} nodes</div>
                  </button>
                ))}
              </div>
            </div>

            {selectedSubnet && (
              <div className="details-section">
                <h2 className="details-title">Subnet Details</h2>
                <div className="details-subnet-id">
                  <span className="details-subnet-label">ID:</span>
                  <span className="details-subnet-value">{selectedSubnet.subnetId}</span>
                </div>
                <div className="details-stats-grid">
                  <div>
                    <div className="details-stat-label">Total</div>
                    <div className="details-stat-value">{selectedSubnet.nodeCount.toString()}</div>
                  </div>
                  <div>
                    <div className="details-stat-label">Gen1</div>
                    <div className="details-stat-value">{selectedSubnet.gen1Count.toString()}</div>
                  </div>
                  <div>
                    <div className="details-stat-label">Gen2</div>
                    <div className="details-stat-value">{selectedSubnet.gen2Count.toString()}</div>
                  </div>
                  <div>
                    <div className="details-stat-label">Unknown</div>
                    <div className="details-stat-value">{selectedSubnet.unknownCount.toString()}</div>
                  </div>
                </div>
                <h3 className="details-nodes-title">Nodes ({selectedSubnet.nodes.length})</h3>
                <div className="nodes-grid">
                  {selectedSubnet.nodes.map((node, index) => (
                    <div key={index} className="node-card">
                      <div className="node-id">{node.nodeId.substring(0, 20)}...</div>
                      <div className={`node-badge ${node.generation.toLowerCase()}`}>
                        {node.generation}
                      </div>
                      {node.region && <div style={{ fontSize: '11px', color: '#9ca3af' }}>Region: {node.region}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!networkStats && !loading && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#93c5fd' }}>
            <h2>Get Started</h2>
            <p>Select and upload your JSON file to view the dashboard</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsCard({ title, value, color, icon, percentage }) {
  return (
    <div className="stats-card">
      <div className="stats-icon">{icon}</div>
      <div className="stats-title" style={{ color }}>{title}</div>
      <div className="stats-value">{value}</div>
      {percentage !== undefined && (
        <div className="stats-percentage">{percentage}%</div>
      )}
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