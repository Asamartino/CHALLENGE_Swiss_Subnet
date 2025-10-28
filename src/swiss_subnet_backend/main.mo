import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Option "mo:base/Option";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";

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

    // ===========================
    // STORAGE
    // ===========================
    
    private var subnetsStable : [(Text, SubnetInfo)] = [];
    private var lastUpdatedStable : Int = 0;
    private transient var subnets = HashMap.HashMap<Text, SubnetInfo>(10, Text.equal, Text.hash);
    private var lastUpdated : Int = 0;
    
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
        
        #ok("Successfully loaded " # Nat.toText(processed) # " nodes across " # Nat.toText(created) # " subnets")
    };

    // ===========================
    // QUERY FUNCTIONS
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
        }
    };

    public shared func refreshData() : async Text {
        subnets := HashMap.HashMap<Text, SubnetInfo>(10, Text.equal, Text.hash);
        lastUpdated := Time.now();
        "All data cleared successfully"
    };
}
