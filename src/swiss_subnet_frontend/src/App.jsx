import { useState, useEffect } from 'react';
import { getActor, getErrorMessage, formatTimestamp, verifyCertificate } from './actor';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const [networkStats, setNetworkStats] = useState(null);
  const [globalStats, setGlobalStats] = useState(null);
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
      setGlobalStats(null);
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
      if (networkStats) {
        setMessage('Clearing old data...');
        await actor.refreshData();
        setNetworkStats(null);
        setGlobalStats(null);
        setSubnets([]);
        setSelectedSubnet(null);
      } else {
        await actor.refreshData();
      }
      
      setMessage('Reading and processing file...');
      
      const fileText = await uploadFile.text();
      const parsedData = JSON.parse(fileText);
      
      let processedNodes = [];
      
      // Check if this is topology.json format
      if (parsedData.subnets && typeof parsedData.subnets === 'object') {
        console.log('📡 Detected topology.json format');
        setMessage('Converting topology format...');
        
        // 1. Process nodes in subnets
        for (const [subnetId, subnetData] of Object.entries(parsedData.subnets)) {
          if (subnetData.nodes && typeof subnetData.nodes === 'object') {
            for (const [nodeId, nodeInfo] of Object.entries(subnetData.nodes)) {
              processedNodes.push({
                node_id: nodeId,
                node_hardware_generation: nodeInfo.node_reward_type || "",
                node_operator_id: nodeInfo.node_operator_id || "",
                node_provider_id: nodeInfo.node_provider_id || "",
                dc_id: nodeInfo.dc_id || "",
                region: nodeInfo.dc_id || "",
                status: "active",
                subnet_id: subnetId
              });
            }
          }
        }
        console.log(`✅ Processed ${processedNodes.length} nodes from subnets`);
        
        // 2. Process unassigned_nodes 
        if (parsedData.unassigned_nodes && typeof parsedData.unassigned_nodes === 'object') {
          const unassignedBefore = processedNodes.length;
          
          for (const [nodeId, nodeInfo] of Object.entries(parsedData.unassigned_nodes)) {
            processedNodes.push({
              node_id: nodeId,
              node_hardware_generation: nodeInfo.node_reward_type || "",
              node_operator_id: nodeInfo.node_operator_id || "",
              node_provider_id: nodeInfo.node_provider_id || "",
              dc_id: nodeInfo.dc_id || "",
              region: nodeInfo.dc_id || "",
              status: "unassigned",
              subnet_id: "unassigned"
            });
          }
          
          const unassignedCount = processedNodes.length - unassignedBefore;
          console.log(`✅ Processed ${unassignedCount} unassigned nodes`);
        }
        
        // 3. Process api_boundary_nodes 
        if (parsedData.api_boundary_nodes && Array.isArray(parsedData.api_boundary_nodes)) {
          const apiBefore = processedNodes.length;
          
          for (const nodeId of parsedData.api_boundary_nodes) {
            let foundInSubnets = false;
            let foundInUnassigned = false;
            
            for (const [subnetId, subnetData] of Object.entries(parsedData.subnets)) {
              if (subnetData.nodes && subnetData.nodes[nodeId]) {
                foundInSubnets = true;
                break;
              }
            }
            
            if (!foundInSubnets && parsedData.unassigned_nodes && parsedData.unassigned_nodes[nodeId]) {
              foundInUnassigned = true;
            }
            
            if (!foundInSubnets && !foundInUnassigned) {
              processedNodes.push({
                node_id: nodeId,
                node_hardware_generation: "",
                node_operator_id: "",
                node_provider_id: "",
                dc_id: "",
                region: "",
                status: "api_boundary",
                subnet_id: "api_boundary"
              });
            }
          }
          
          const apiCount = processedNodes.length - apiBefore;
          console.log(`✅ Processed ${parsedData.api_boundary_nodes.length} API boundary node IDs (${apiCount} new)`);
        }
        
        console.log(`✅ TOTAL: ${processedNodes.length} nodes from topology.json`);
        
      } else {
        console.log('📡 Detected flat nodes format');
        const nodes = parsedData.nodes || parsedData;
        
        processedNodes = nodes
          .filter(node => node.subnet_id)
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
      }
      
      console.log(`Processing ${processedNodes.length} total nodes`);
      console.log("Sample node:", processedNodes[0]);
      
      setMessage(`Uploading ${processedNodes.length} nodes...`);
      
      const result = await actor.loadNodesFromFile(processedNodes);

      if (result && 'ok' in result) {
        setMessage(result.ok);
        
        console.log("🔄 Updating certification...");
        try {
          await actor.updateCertification();
          console.log("✅ Certification updated");
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (certErr) {
          console.warn("⚠️ Failed to update certification:", certErr);
        }
        
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
      
      // Fetch global stats (all nodes including unassigned)
      try {
        const globalStatsData = await actor.getGlobalStats();
        setGlobalStats(globalStatsData);
        console.log("📊 Global stats loaded:", globalStatsData);
      } catch (err) {
        console.warn("Failed to fetch global stats:", err);
      }
      
      // Clear message after delay if not certificate status
      if (!certificateValid) {
        setTimeout(() => setMessage(''), 5000);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load data: ' + getErrorMessage(err));
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

  // Filter out virtual subnets (unassigned, api_boundary) for stats and display
  const realSubnets = subnets.filter(subnet => 
    subnet.subnetId !== 'unassigned' && subnet.subnetId !== 'api_boundary'
  );

  const realSubnetStats = networkStats ? {
    totalSubnets: realSubnets.length,
    totalNodes: realSubnets.reduce((sum, s) => sum + Number(s.nodeCount), 0),
    gen1Nodes: realSubnets.reduce((sum, s) => sum + Number(s.gen1Count), 0),
    gen2Nodes: realSubnets.reduce((sum, s) => sum + Number(s.gen2Count), 0),
  } : null;

  const pieData = realSubnetStats ? [
    { name: 'Gen1', value: realSubnetStats.gen1Nodes, color: '#8b5cf6' },
    { name: 'Gen2', value: realSubnetStats.gen2Nodes, color: '#06b6d4' },
  ].filter(item => item.value > 0) : [];

  const subnetChartData = realSubnets.slice(0, 10).map(subnet => ({
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
              Select Subnet and Node topology (JSON File)
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

        {networkStats && realSubnetStats && (
          <>
            {globalStats && (
                <div className="top-summary">
                  <h2 className="top-summary-title">🌐 Complete Nodes Overview</h2>
                  <div className="top-summary-grid">
                    <div className="top-summary-card total">
                      <div className="top-summary-icon">🖥️</div>
                      <div className="top-summary-label">Total Nodes</div>
                      <div className="top-summary-value">{globalStats.totalNodes.toString()}</div>
                    </div>
                    
                    <div className="top-summary-card gen1">
                      <div className="top-summary-icon">📦</div>
                      <div className="top-summary-label">Gen1 Nodes</div>
                      <div className="top-summary-value">{globalStats.gen1Nodes.toString()}</div>
                      <div className="top-summary-percentage">
                        {globalStats.totalNodes > 0 ? ((Number(globalStats.gen1Nodes) / Number(globalStats.totalNodes)) * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                    
                    <div className="top-summary-card gen2">
                      <div className="top-summary-icon">⚡</div>
                      <div className="top-summary-label">Gen2 Nodes</div>
                      <div className="top-summary-value">{globalStats.gen2Nodes.toString()}</div>
                      <div className="top-summary-percentage">
                        {globalStats.totalNodes > 0 ? ((Number(globalStats.gen2Nodes) / Number(globalStats.totalNodes)) * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                    
                    <div className="top-summary-card unknown">
                      <div className="top-summary-icon">❓</div>
                      <div className="top-summary-label">Unknown Nodes</div>
                      <div className="top-summary-value">{globalStats.unknownNodes.toString()}</div>
                      <div className="top-summary-percentage">
                        {globalStats.totalNodes > 0 ? ((Number(globalStats.unknownNodes) / Number(globalStats.totalNodes)) * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                  </div>
                </div>
              )}
            
            <div className="top-summary">
              <h2 className="top-summary-title">📊 Complete Subnet Overview</h2>
              <div className="top-summary-grid">
                <div className="top-summary-card total">
                  <div className="top-summary-icon">🔗</div>
                  <div className="top-summary-label">Total Subnets</div>
                  <div className="top-summary-value">{realSubnetStats.totalSubnets.toString()}</div>
                </div>
                
                <div className="top-summary-card total">
                  <div className="top-summary-icon">🖥️</div>
                  <div className="top-summary-label">Total Nodes</div>
                  <div className="top-summary-value">{realSubnetStats.totalNodes.toString()}</div>
                </div>
                
                <div className="top-summary-card gen1">
                  <div className="top-summary-icon">📦</div>
                  <div className="top-summary-label">Gen1 Nodes</div>
                  <div className="top-summary-value">{realSubnetStats.gen1Nodes.toString()}</div>
                  <div className="top-summary-percentage">
                    {realSubnetStats.totalNodes > 0 ? ((realSubnetStats.gen1Nodes / realSubnetStats.totalNodes) * 100).toFixed(1) : 0}%
                  </div>
                </div>
                
                <div className="top-summary-card gen2">
                  <div className="top-summary-icon">⚡</div>
                  <div className="top-summary-label">Gen2 Nodes</div>
                  <div className="top-summary-value">{realSubnetStats.gen2Nodes.toString()}</div>
                  <div className="top-summary-percentage">
                    {realSubnetStats.totalNodes > 0 ? ((realSubnetStats.gen2Nodes / realSubnetStats.totalNodes) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              </div>
            </div>


            <div className="subnets-section">
              <h2 className="subnets-title">Real Subnets ({realSubnets.length})</h2>
              <div className="subnets-grid">
                {realSubnets.map((subnet, index) => (
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
                </div>
                <h3 className="details-nodes-title">Nodes ({selectedSubnet.nodes.length})</h3>
                <div className="nodes-grid">
                  {selectedSubnet.nodes.map((node, index) => (
                    <div key={index} className="node-card">
                      <div className="node-id">{node.nodeId}</div>
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