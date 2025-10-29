import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import CertifiedData "mo:base/CertifiedData";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Option "mo:base/Option";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import SHA256 "mo:sha2/Sha256";
// import Debug "mo:base/Debug"; 

persistent actor SubnetDashboard {
    
    // ===========================
    // TYPE DEFINITIONS
    // ===========================
    
    public type NodeInfo = {
        nodeId: Text;
        generation: Text;
        nodeOperatorId: Text;
        nodeProviderId: Text;
        dcId: Text;
        region: Text;
        status: Text;
    };

    public type SubnetInfo = {
        subnetId: Text;
        subnetType: Text;
        nodeCount: Nat;
        gen1Count: Nat;
        gen2Count: Nat;
        unknownCount: Nat;
        nodes: [NodeInfo];
    };

    public type NetworkStats = {
        totalSubnets: Nat;
        totalNodes: Nat;
        gen1Nodes: Nat;
        gen2Nodes: Nat;
        unknownNodes: Nat;
        lastUpdated: Int;
    };

    public type NodeFromFile = {
        node_id: Text;
        node_hardware_generation: Text;
        node_operator_id: Text;
        node_provider_id: Text;
        dc_id: Text;
        region: Text;
        status: Text;
        subnet_id: Text;
    };

    // Certificate types for certified queries
    public type CertifiedNetworkStats = {
        stats: NetworkStats;
        certificate: ?Blob;
        witness: Blob;
    };

    public type CertifiedSubnetInfo = {
        subnet: ?SubnetInfo;
        certificate: ?Blob;
        witness: Blob;
    };

    // ===========================
    // STORAGE
    // ===========================
    
    private var subnetsStable : [(Text, SubnetInfo)] = [];
    private var lastUpdatedStable : Int = 0;
    private transient var subnets = HashMap.HashMap<Text, SubnetInfo>(10, Text.equal, Text.hash);
    private var lastUpdated : Int = 0;
    
    // Store the last certified hash to ensure consistency
    /////////////////////////////////////////// private var lastCertifiedStatsHash : Blob = Blob.fromArray([]);
    private var lastCertifiedStats : ?NetworkStats = null;

    // ===========================
    // UPGRADE HOOKS
    // ===========================
    
    system func preupgrade() {
        subnetsStable := Iter.toArray(subnets.entries());
        lastUpdatedStable := lastUpdated;
    };
    
    system func postupgrade() {
        for ((key, value) in subnetsStable.vals()) {
            subnets.put(key, value);
        };
        lastUpdated := lastUpdatedStable;
        subnetsStable := [];
        
        // Update certified data after upgrade
        updateCertifiedData();
    };

    // ===========================
    // CERTIFIED DATA MANAGEMENT
    // ===========================

    /// Compute hash of network stats for certification
    /// Uses a simple but effective hashing approach for the data
    private func computeStatsHash(stats: NetworkStats) : Blob {
        let dataText = debug_show(stats);
        let dataBlob = Text.encodeUtf8(dataText);
        SHA256.fromBlob(#sha256, dataBlob); 
    };

    /// Compute hash of subnet info for certification
    private func computeSubnetHash(subnet: SubnetInfo) : Blob {
        let dataText = debug_show(subnet);
        let dataBlob = Text.encodeUtf8(dataText);
        SHA256.fromBlob(#sha256, dataBlob);  
    };

    /// Update the canister's certified data with current stats hash
    // private func updateCertifiedData() {
    //     let stats = calculateStats();
    //     let hash = computeStatsHash(stats);
    //     lastCertifiedStatsHash := hash; // Store it for later use
    //     CertifiedData.set(hash);
    // };
    ///////////////////////////////////////////////////////////////////////////////
    private func updateCertifiedData() {
        let stats = calculateStats();
        let hash = computeStatsHash(stats);

        // Store the stats object itself for the certified query
        lastCertifiedStats := ?stats; 

        // Set the hash in the certified data tree
        CertifiedData.set(hash);
    };

    // ===========================
    // HELPER FUNCTIONS
    // ===========================

    private func calculateStats() : NetworkStats {
        var totalNodes = 0;
        var gen1Total = 0;
        var gen2Total = 0;
        var unknownTotal = 0;
        
        for (subnet in subnets.vals()) {
            totalNodes += subnet.nodeCount;
            gen1Total += subnet.gen1Count;
            gen2Total += subnet.gen2Count;
            unknownTotal += subnet.unknownCount;
        };
        
        {
            totalSubnets = subnets.size();
            totalNodes = totalNodes;
            gen1Nodes = gen1Total;
            gen2Nodes = gen2Total;
            unknownNodes = unknownTotal;
            lastUpdated = lastUpdated;
        }
    };

    private func classifyNode(generation: Text) : Text {
        if (generation == "Gen1") { "Gen1" }
        else if (generation == "Gen2") { "Gen2" }
        else { "Unknown" }
    };

    private func updateSubnetCounts(subnetId: Text) {
        switch (subnets.get(subnetId)) {
            case (?subnet) {
                var gen1 = 0;
                var gen2 = 0;
                var unknown = 0;
                
                for (node in subnet.nodes.vals()) {
                    switch (node.generation) {
                        case ("Gen1") { gen1 += 1 };
                        case ("Gen2") { gen2 += 1 };
                        case (_) { unknown += 1 };
                    };
                };
                
                let updatedSubnet : SubnetInfo = {
                    subnetId = subnet.subnetId;
                    subnetType = subnet.subnetType;
                    nodeCount = subnet.nodes.size();
                    gen1Count = gen1;
                    gen2Count = gen2;
                    unknownCount = unknown;
                    nodes = subnet.nodes;
                };
                
                subnets.put(subnetId, updatedSubnet);
            };
            case null { };
        };
    };

    // ===========================
    // DATA MANAGEMENT
    // ===========================

    public shared func loadNodesFromFile(nodes: [NodeFromFile]) : async Result.Result<Text, Text> {
        var processed = 0;
        var created = 0;
        
        for (nodeData in nodes.vals()) {
            let subnetId = nodeData.subnet_id;
            
            // Only process if subnet_id is not empty
            if (subnetId != "") {
                if (Option.isNull(subnets.get(subnetId))) {
                    subnets.put(subnetId, {
                        subnetId; 
                        subnetType = "Application";
                        nodeCount = 0; 
                        gen1Count = 0; 
                        gen2Count = 0;
                        unknownCount = 0; 
                        nodes = [];
                    });
                    created += 1;
                };
                
                switch (subnets.get(subnetId)) {
                    case (?subnet) {
                        let nodesBuffer = Buffer.Buffer<NodeInfo>(subnet.nodes.size() + 1);
                        for (node in subnet.nodes.vals()) { nodesBuffer.add(node) };
                        
                        nodesBuffer.add({
                            nodeId = nodeData.node_id;
                            generation = classifyNode(nodeData.node_hardware_generation);
                            nodeOperatorId = nodeData.node_operator_id;
                            nodeProviderId = nodeData.node_provider_id;
                            dcId = nodeData.dc_id;
                            region = nodeData.region;
                            status = nodeData.status;
                        });
                        
                        subnets.put(subnetId, {
                            subnetId = subnet.subnetId;
                            subnetType = subnet.subnetType;
                            nodeCount = nodesBuffer.size();
                            gen1Count = subnet.gen1Count;
                            gen2Count = subnet.gen2Count;
                            unknownCount = subnet.unknownCount;
                            nodes = Buffer.toArray(nodesBuffer);
                        });
                        processed += 1;
                    };
                    case null { };
                };
            };
        };
        
        // Update counts for all subnets
        for (subnetId in subnets.keys()) {
            updateSubnetCounts(subnetId);
        };
        
        lastUpdated := Time.now();
        
        // Update certified data after loading nodes
        updateCertifiedData();
        
        #ok("Successfully loaded " # Nat.toText(processed) # " nodes across " # Nat.toText(created) # " subnets")
    };

    // ===========================
    // QUERY FUNCTIONS (Regular)
    // ===========================
    
    public query func getSubnets() : async [SubnetInfo] {
        Iter.toArray(subnets.vals())
    };

    public query func getSubnetById(subnetId: Text) : async Result.Result<SubnetInfo, Text> {
        switch (subnets.get(subnetId)) {
            case (?subnet) { #ok(subnet) };
            case null { #err("Subnet not found") };
        }
    };

    public query func getNetworkStats() : async NetworkStats {
        calculateStats()
    };

    public query func healthCheck() : async {
        status: Text;
        subnetsCount: Nat;
        totalNodes: Nat;
        gen1Nodes: Nat;
        gen2Nodes: Nat;
        unknownNodes: Nat;
        lastUpdated: Int;
        hasCertificate: Bool;
    } {
        let stats = calculateStats();
        {
            status = "healthy";
            subnetsCount = stats.totalSubnets;
            totalNodes = stats.totalNodes;
            gen1Nodes = stats.gen1Nodes;
            gen2Nodes = stats.gen2Nodes;
            unknownNodes = stats.unknownNodes;
            lastUpdated = lastUpdated;
            hasCertificate = true;
        }
    };

    // ===========================
    // CERTIFIED QUERY FUNCTIONS
    // ===========================

    /// Get network stats with certificate
    /// CRITICAL: The witness must be the SAME hash that was certified
//    public query func getNetworkStatsCertified() : async CertifiedNetworkStats {
//         Debug.print("🔍 getNetworkStatsCertified called");
        
//         let stats = calculateStats();
//         Debug.print("📊 Stats calculated: " # debug_show(stats));
        
//         // Use the hash that was ALREADY certified during an update call
//         let witness = lastCertifiedStatsHash;
//         Debug.print("🔐 Using stored hash, length: " # Nat.toText(Blob.toArray(witness).size()));
        
//         // Get the certificate from the IC
//         let cert = CertifiedData.getCertificate();
//         Debug.print("📜 Certificate obtained: " # (if (Option.isSome(cert)) { "YES" } else { "NO" }));
        
//         {
//             stats = stats;
//             certificate = cert;
//             witness = witness;
//         }
//     };
public query func getNetworkStatsCertified() : async CertifiedNetworkStats {
    // Debug.print("🔍 getNetworkStatsCertified called");

    // Get the certificate from the IC
    let cert = CertifiedData.getCertificate();
    // Debug.print("🔍 Certificate obtained: " # (if (Option.isSome(cert)) { "YES" } else { "NO" }));

    switch (lastCertifiedStats) {
        case (?stats) {
            // Use the *stored* stats from the last update
            // Debug.print("Using stored stats: " # debug_show(stats));

            // Re-compute the hash from the stored stats to use as the witness.
            // This witness MUST match what was set in updateCertifiedData.
            let witness = computeStatsHash(stats);
            // Debug.print(" Computed witness from stored stats, length: " # Nat.toText(Blob.toArray(witness).size()));

            {
                stats = stats;
                certificate = cert;
                witness = witness;
            }
        };
        case (null) {
            // No data has been certified yet, return empty stats
            // Debug.print("- No certified stats found.");
            let emptyStats : NetworkStats = {
                totalSubnets = 0;
                totalNodes = 0;
                gen1Nodes = 0;
                gen2Nodes = 0;
                unknownNodes = 0;
                lastUpdated = 0;
            };
            let emptyHash = computeStatsHash(emptyStats);

            {
                stats = emptyStats;
                certificate = cert;
                witness = emptyHash;
            }
        };
    }
};

    /// Get subnet info with certificate
    public query func getSubnetByIdCertified(subnetId: Text) : async CertifiedSubnetInfo {
        let subnetOpt = subnets.get(subnetId);
        
        let witness = switch (subnetOpt) {
            case (?subnet) { computeSubnetHash(subnet) };
            case null { 
                // Return SHA-256 hash of empty string
                SHA256.fromBlob(#sha256, Text.encodeUtf8(""));
            };
        };
        
        let cert = CertifiedData.getCertificate();
        
        {
            subnet = subnetOpt;
            certificate = cert;
            witness = witness;
        }
    };

    /// Get all subnets with certificate
    public query func getSubnetsCertified() : async {
        subnets: [SubnetInfo];
        certificate: ?Blob;
        witness: Blob;
    } {
        let subnetsArray = Iter.toArray(subnets.vals());
        
        // Compute SHA-256 hash of subnets count
        let dataText = "subnets_count:" # Nat.toText(subnetsArray.size());
        let witness = SHA256.fromBlob(#sha256, Text.encodeUtf8(dataText));
        
        let cert = CertifiedData.getCertificate();
        
        {
            subnets = subnetsArray;
            certificate = cert;
            witness = witness;
        }
    };

    // ===========================
    // ADMIN FUNCTIONS
    // ===========================

    public shared func refreshData() : async Text {
        subnets := HashMap.HashMap<Text, SubnetInfo>(10, Text.equal, Text.hash);
        lastUpdated := Time.now();
        
        // Update certified data after clearing
        updateCertifiedData();
        
        "All data cleared successfully"
    };

    /// Manual function to update certified data (useful for testing)
    public shared func updateCertification() : async Text {
        updateCertifiedData();
        "Certified data updated successfully"
    };

}
