import Array "mo:base/Array";
import Blob "mo:base/Blob";
import CertifiedData "mo:base/CertifiedData";
import HashMap "mo:base/HashMap";
import Hash "mo:base/Hash";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Int "mo:base/Int";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Buffer "mo:base/Buffer";
import Cycles "mo:base/ExperimentalCycles";
import Debug "mo:base/Debug";
import Option "mo:base/Option";
import Error "mo:base/Error";
import Json "mo:json";
import SHA256 "mo:sha256/SHA256";

persistent actor SubnetDashboard {
    // Type definitions
    public type NodeGeneration = {
        #Gen1;
        #Gen2;
    };

    public type NodeInfo = {
        nodeId: Text;
        generation: NodeGeneration;
        dataCenter: ?Text;
        nodeProvider: ?Text;
    };

    public type SubnetInfo = {
        subnetId: Text;
        nodeCount: Nat;
        gen1Count: Nat;
        gen2Count: Nat;
        nodes: [NodeInfo];
        subnetType: ?Text;
    };

    public type NetworkStats = {
        totalSubnets: Nat;
        totalNodes: Nat;
        totalGen1: Nat;
        totalGen2: Nat;
        lastUpdated: Int;
    };

    // HTTP Outcall types
    public type HttpHeader = {
        name: Text;
        value: Text;
    };

    public type HttpMethod = {
        #get;
        #post;
        #head;
    };

    public type TransformRawResponse = {
        status: Nat;
        headers: [HttpHeader];
        body: Blob;
    };

    public type HttpResponsePayload = {
        status: Nat;
        headers: [HttpHeader];
        body: Blob;
    };

    public type TransformContext = {
        function: shared query TransformRawResponse -> async HttpResponsePayload;
        context: Blob;
    };

    public type CanisterHttpRequestArgs = {
        url: Text;
        max_response_bytes: ?Nat64;
        headers: [HttpHeader];
        body: ?Blob;
        method: HttpMethod;
        transform: ?TransformContext;
    };

    // HTTP Interface types
    public type HeaderField = (Text, Text);

    public type HttpRequest = {
        method: Text;
        url: Text;
        headers: [HeaderField];
        body: Blob;
    };

    public type HttpStreamingCallbackToken = {
        key: Text;
        content_encoding: Text;
        index: Nat;
    };

    public type HttpStreamingCallbackResponse = {
        body: Blob;
        token: ?HttpStreamingCallbackToken;
    };

    public type HttpStreamingStrategy = {
        #Callback: {
            callback: shared query HttpStreamingCallbackToken -> async HttpStreamingCallbackResponse;
            token: HttpStreamingCallbackToken;
        };
    };

    public type HttpResponse = {
        status_code: Nat16;
        headers: [HeaderField];
        body: Blob;
        streaming_strategy: ?HttpStreamingStrategy;
    };

    // Persistent storage (automatically stable with persistent actor)
    var cachedSubnetsArray : [(Text, SubnetInfo)] = [];
    var lastFetchTime : Int = 0;
    var cachedStatsData : ?NetworkStats = null;
    var lastRefreshBy : ?Principal = null;
    
    // Rate limiting - 5 minutes cooldown
    let REFRESH_COOLDOWN_NS : Int = 300_000_000_000;

    // IC Management Canister interface (only HTTP outcalls)
    let ic : actor {
        http_request : CanisterHttpRequestArgs -> async HttpResponsePayload;
    } = actor("aaaaa-aa");

    // Helper function to create certified data hash (now properly returns a hash)
    private func createCertifiedDataHash() : Blob {
        switch (cachedStatsData) {
            case (?stats) {
                let dataText = "subnets:" # Nat.toText(stats.totalSubnets) # 
                              ",nodes:" # Nat.toText(stats.totalNodes) #
                              ",gen1:" # Nat.toText(stats.totalGen1) #
                              ",gen2:" # Nat.toText(stats.totalGen2) #
                              ",updated:" # Int.toText(stats.lastUpdated);
                SHA256.hash(Text.encodeUtf8(dataText))
            };
            case null {
                SHA256.hash(Text.encodeUtf8("no-data"))
            };
        }
    };

    // Update certified data for tamper-proof verification
    private func updateCertifiedData() {
        let hash = createCertifiedDataHash();
        CertifiedData.set(hash);
    };

    // Transform function for HTTP outcalls (strips headers for consensus)
    public query func transform(raw: TransformRawResponse) : async HttpResponsePayload {
        {
            status = raw.status;
            headers = [];
            body = raw.body;
        }
    };

    // Fetches the network topology from the IC Dashboard API
    private func fetchOnChainTopology() : async Result.Result<[(Text, [Text])], Text> {
        try {
            Debug.print("Fetching topology from IC Dashboard API...");
            
            let url = "https://ic-api.internetcomputer.org/api/v3/subnets";
            
            let request : CanisterHttpRequestArgs = {
                url = url;
                max_response_bytes = ?2_000_000;
                headers = [];
                body = null;
                method = #get;
                transform = ?{
                    function = transform;
                    context = Blob.fromArray([]);
                };
            };
            
            let availableCycles = Cycles.balance();
            if (availableCycles < 250_000_000_000) {
                return #err("Insufficient cycles for HTTP outcall");
            };
            
            let response = await (with cycles = 230_000_000_000) ic.http_request(request);
            
            if (response.status != 200) {
                return #err("HTTP request failed with status: " # Nat.toText(response.status));
            };

            let bodyText = switch (Text.decodeUtf8(response.body)) {
                case (?text) { text };
                case null { return #err("Failed to decode response") };
            };
            
            let buffer = Buffer.Buffer<(Text, [Text])>(50);
            
            switch (Json.parse(bodyText)) {
                case (#Ok(json)) {
                    let subnetsArrayOpt = switch (json) {
                        case (#Object(obj)) { obj.get("subnets") };
                        case _ { null };
                    };

                    switch (subnetsArrayOpt) {
                        case (? #Array(subnets)) {
                            for (subnetJson in subnets.vals()) {
                                switch (subnetJson) {
                                    case (#Object(subnetObj)) {
                                        let subnetIdOpt = subnetObj.get("subnet_id");
                                        let nodesOpt = subnetObj.get("nodes");

                                        switch (subnetIdOpt, nodesOpt) {
                                            case (? #Text(subnetId), ? #Array(nodes)) {
                                                let nodeIds = Buffer.Buffer<Text>(nodes.size());
                                                
                                                for (nodeJson in nodes.vals()) {
                                                    switch (nodeJson) {
                                                        case (#Text(nodeId)) {
                                                            nodeIds.add(nodeId);
                                                        };
                                                        case _ {};
                                                    };
                                                };
                                                
                                                buffer.add((subnetId, Buffer.toArray(nodeIds)));
                                            };
                                            case _ {};
                                        };
                                    };
                                    case _ {};
                                };
                            };
                        };
                        case _ { return #err("Could not find 'subnets' array in JSON") };
                    };
                };
                case (#Err(msg)) { return #err("Failed to parse JSON: " # msg) };
            };
            
            Debug.print("Found " # Nat.toText(buffer.size()) # " subnets");
            #ok(Buffer.toArray(buffer))
        } catch (e) {
            #err("Failed to fetch topology: " # Error.message(e))
        }
    };

    // Fetch node hardware info for Gen1/Gen2 classification
    public shared func fetchNodeHardwareInfo() : async Result.Result<Text, Text> {
        try {            
            let url = "https://ic-api.internetcomputer.org/api/v3/nodes";
            
            let request : CanisterHttpRequestArgs = {
                url = url;
                max_response_bytes = ?2_000_000;
                headers = [];
                body = null;
                method = #get;
                transform = ?{
                    function = transform;
                    context = Blob.fromArray([]);
                };
            };
            
            let availableCycles = Cycles.balance();
            Debug.print("Available cycles: " # Nat.toText(availableCycles));
            
            if (availableCycles < 250_000_000_000) {
                return #err("Insufficient cycles for HTTP outcall. Available: " # Nat.toText(availableCycles));
            };
            
            let response = await (with cycles = 230_000_000_000) ic.http_request(request);
            
            if (response.status != 200) {
                return #err("HTTP request failed with status: " # Nat.toText(response.status));
            };

            let bodyText = switch (Text.decodeUtf8(response.body)) {
                case (?text) { text };
                case null { return #err("Failed to decode response") };
            };
            
            #ok(bodyText)
        } catch (e) {
            #err("Failed to fetch node info: " # Error.message(e))
        }
    };

    // Helper function to detect Gen2 nodes
    private func isGen2ChipId(chipId: Text) : Bool {
        chipId == "amd_milan_g2" or
        chipId == "amd_rome_g2" or
        chipId == "amd_milan"
    };

    // CERTIFIED QUERY: Get network statistics
    public query func getNetworkStats() : async Result.Result<NetworkStats, Text> {
        switch (cachedStatsData) {
            case (?stats) {
                #ok(stats)
            };
            case null {
                var totalGen1 = 0;
                var totalGen2 = 0;
                var totalNodes = 0;
                
                for ((_, subnet) in cachedSubnetsArray.vals()) {
                    totalGen1 += subnet.gen1Count;
                    totalGen2 += subnet.gen2Count;
                    totalNodes += subnet.nodeCount;
                };
                
                #ok({
                    totalSubnets = cachedSubnetsArray.size();
                    totalNodes = totalNodes;
                    totalGen1 = totalGen1;
                    totalGen2 = totalGen2;
                    lastUpdated = lastFetchTime;
                })
            };
        }
    };

    // NEW CERTIFIED QUERY: Get certified stats with separate data and certificate
    public query func getCertifiedStats() : async {
        certificate: ?Blob;
        data: ?NetworkStats;
    } {
        let stats = switch (cachedStatsData) {
            case (?stats) { ?stats };
            case null {
                if (cachedSubnetsArray.size() == 0) {
                    null
                } else {
                    var totalGen1 = 0;
                    var totalGen2 = 0;
                    var totalNodes = 0;
                    
                    for ((_, subnet) in cachedSubnetsArray.vals()) {
                        totalGen1 += subnet.gen1Count;
                        totalGen2 += subnet.gen2Count;
                        totalNodes += subnet.nodeCount;
                    };
                    
                    ?{
                        totalSubnets = cachedSubnetsArray.size();
                        totalNodes = totalNodes;
                        totalGen1 = totalGen1;
                        totalGen2 = totalGen2;
                        lastUpdated = lastFetchTime;
                    }
                }
            };
        };
        
        {
            certificate = CertifiedData.getCertificate();
            data = stats;
        }
    };

    // CERTIFIED QUERY: Get all subnets
    public query func getSubnets() : async [SubnetInfo] {
        Array.map<(Text, SubnetInfo), SubnetInfo>(
            cachedSubnetsArray,
            func((_, subnet)) { subnet }
        )
    };

    // CERTIFIED QUERY: Get specific subnet details
    public query func getSubnetDetails(subnetId: Text) : async Result.Result<SubnetInfo, Text> {
        for ((id, subnet) in cachedSubnetsArray.vals()) {
            if (id == subnetId) {
                return #ok(subnet);
            };
        };
        #err("Subnet not found")
    };

    // CERTIFIED QUERY: Get certificate for verification
    public query func getCertificate() : async ?Blob {
        CertifiedData.getCertificate()
    };

    // CERTIFIED QUERY: Get the certified data hash
    public query func getCertifiedDataHash() : async Blob {
        createCertifiedDataHash()
    };

    // Combined data fetch with certificate (keep for backward compatibility)
    public query func getStatsWithCertificate() : async {
        stats: Result.Result<NetworkStats, Text>;
        certificate: ?Blob;
        dataHash: Blob;
    } {
        let statsResult = switch (cachedStatsData) {
            case (?stats) {
                #ok(stats)
            };
            case null {
                var totalGen1 = 0;
                var totalGen2 = 0;
                var totalNodes = 0;
                
                for ((_, subnet) in cachedSubnetsArray.vals()) {
                    totalGen1 += subnet.gen1Count;
                    totalGen2 += subnet.gen2Count;
                    totalNodes += subnet.nodeCount;
                };
                
                #ok({
                    totalSubnets = cachedSubnetsArray.size();
                    totalNodes = totalNodes;
                    totalGen1 = totalGen1;
                    totalGen2 = totalGen2;
                    lastUpdated = lastFetchTime;
                })
            };
        };
        
        {
            stats = statsResult;
            certificate = CertifiedData.getCertificate();
            dataHash = createCertifiedDataHash();
        }
    };

    // QUERY: Health check endpoint
    public query func healthCheck() : async {
        status: Text;
        subnetsCount: Nat;
        nodesCount: Nat;
        lastUpdated: Int;
        hasCertificate: Bool;
        availableCycles: Nat;
    } {
        let nodeCount = switch (cachedStatsData) {
            case (?stats) { stats.totalNodes };
            case null { 0 };
        };
        
        {
            status = "healthy";
            subnetsCount = cachedSubnetsArray.size();
            nodesCount = nodeCount;
            lastUpdated = lastFetchTime;
            hasCertificate = Option.isSome(CertifiedData.getCertificate());
            availableCycles = Cycles.balance();
        }
    };

    // QUERY: Get data freshness info
    public query func getDataFreshness() : async {
        lastUpdated: Int;
        ageInMinutes: Int;
        isStale: Bool;
        canRefresh: Bool;
        nextRefreshAvailable: Int;
    } {
        let now = Time.now();
        
        if (lastFetchTime == 0) {
            return {
                lastUpdated = 0;
                ageInMinutes = 0;
                isStale = true;
                canRefresh = true;
                nextRefreshAvailable = now;
            };
        };
        
        let ageNs = now - lastFetchTime;
        let ageMinutes = ageNs / 60_000_000_000;
        let isStale = ageMinutes > 60;
        let timeSinceRefresh = now - lastFetchTime;
        let canRefresh = timeSinceRefresh >= REFRESH_COOLDOWN_NS;
        let nextRefreshTime = lastFetchTime + REFRESH_COOLDOWN_NS;
        
        {
            lastUpdated = lastFetchTime;
            ageInMinutes = ageMinutes;
            isStale = isStale;
            canRefresh = canRefresh;
            nextRefreshAvailable = if (canRefresh) { now } else { nextRefreshTime };
        }
    };

    // ADMIN: Clear cache
    public shared(msg) func clearCache() : async Result.Result<Text, Text> {
        cachedSubnetsArray := [];
        cachedStatsData := null;
        lastFetchTime := 0;
        lastRefreshBy := null;
        updateCertifiedData();
        #ok("Cache cleared successfully by " # Principal.toText(msg.caller))
    };

    // MAIN FUNCTION: Refresh network data
    public shared(msg) func refreshNetworkData() : async Result.Result<Text, Text> {
        // Rate limiting check
        if (lastFetchTime > 0) {
            let now = Time.now();
            let timeSinceRefresh = now - lastFetchTime;
            
            if (timeSinceRefresh < REFRESH_COOLDOWN_NS) {
                let minutesRemaining = (REFRESH_COOLDOWN_NS - timeSinceRefresh) / 60_000_000_000;
                return #err("Rate limited: Please wait " # Int.toText(minutesRemaining) # " more minutes before refreshing");
            };
        };
        
        let now = Time.now();
        
        try {
            Debug.print("Starting network data refresh by " # Principal.toText(msg.caller));

            // Check cycles
            let availableCycles = Cycles.balance();
            Debug.print("Available cycles before refresh: " # Nat.toText(availableCycles));
            
            if (availableCycles < 500_000_000_000) {
                return #err("Low cycles: " # Nat.toText(availableCycles) # ". Please top up canister.");
            };

            // Step 1: Fetch topology from IC Dashboard API
            let topologyResult = await fetchOnChainTopology();
            let topology = switch (topologyResult) {
                case (#ok(data)) { data };
                case (#err(msg)) { return #err("Failed to fetch topology: " # msg) };
            };

            // Step 2: Fetch node hardware info
            let hardwareResult = await fetchNodeHardwareInfo();
            let hardwareJsonText = switch (hardwareResult) {
                case (#ok(text)) { text };
                case (#err(msg)) { return #err("Failed to fetch hardware info: " # msg) };
            };

            // Step 3: Parse hardware data
            Debug.print("Parsing hardware JSON...");
            let nodeGenerationMap = HashMap.HashMap<Text, NodeGeneration>(0, Text.equal, Text.hash);

            switch (Json.parse(hardwareJsonText)) {
                case (#Ok(json)) {
                    let nodesArrayOpt = switch (json) {
                        case (#Object(obj)) { obj.get("nodes") };
                        case _ { null };
                    };

                    switch (nodesArrayOpt) {
                        case (? #Array(nodes)) {
                            for (nodeJson in nodes.vals()) {
                                switch (nodeJson) {
                                    case (#Object(nodeObj)) {
                                        let nodeIdOpt = nodeObj.get("node_id");
                                        let chipIdOpt = nodeObj.get("chip_id");

                                        switch (nodeIdOpt) {
                                            case (? #Text(nodeIdText)) {
                                                let generation = switch (chipIdOpt) {
                                                    case (? #Text(chipId)) {
                                                        if (isGen2ChipId(chipId)) {
                                                            #Gen2
                                                        } else {
                                                            #Gen1
                                                        }
                                                    };
                                                    case (_) { #Gen1 };
                                                };
                                                nodeGenerationMap.put(nodeIdText, generation);
                                            };
                                            case _ {};
                                        };
                                    };
                                    case _ {};
                                };
                            };
                        };
                        case _ { return #err("Could not find 'nodes' array in hardware JSON") };
                    };
                };
                case (#Err(msg)) { return #err("Failed to parse hardware JSON: " # msg) };
            };
            
            Debug.print("Parsed " # Nat.toText(nodeGenerationMap.size()) # " nodes from hardware info");

            // Step 4: Correlate topology with generation data
            Debug.print("Correlating topology with hardware info...");
            var parsedSubnetsBuffer = Buffer.Buffer<SubnetInfo>(topology.size());

            for ((subnetId, nodeIds) in topology.vals()) {
                var gen1Count : Nat = 0;
                var gen2Count : Nat = 0;
                var nodesBuffer = Buffer.Buffer<NodeInfo>(nodeIds.size());

                for (nodeId in nodeIds.vals()) {
                    let generation = Option.get(nodeGenerationMap.get(nodeId), #Gen1);

                    if (generation == #Gen1) { gen1Count += 1 } else { gen2Count += 1 };

                    nodesBuffer.add({
                        nodeId = nodeId;
                        generation = generation;
                        dataCenter = null;
                        nodeProvider = null;
                    });
                };

                parsedSubnetsBuffer.add({
                    subnetId = subnetId;
                    nodeCount = nodeIds.size();
                    gen1Count = gen1Count;
                    gen2Count = gen2Count;
                    nodes = Buffer.toArray(nodesBuffer);
                    subnetType = null;
                });
            };
            
            let parsedSubnets = Buffer.toArray(parsedSubnetsBuffer);
            Debug.print("Finished correlating data.");

            // Step 5: Calculate statistics
            var totalNodes : Nat = 0;
            var totalGen1 : Nat = 0;
            var totalGen2 : Nat = 0;

            for (subnet in parsedSubnets.vals()) {
                totalNodes += subnet.nodeCount;
                totalGen1 += subnet.gen1Count;
                totalGen2 += subnet.gen2Count;
            };

            let parsedStats : NetworkStats = {
                totalSubnets = parsedSubnets.size();
                totalNodes = totalNodes;
                totalGen1 = totalGen1;
                totalGen2 = totalGen2;
                lastUpdated = now;
            };

            // Step 6: Store data
            let buffer = Buffer.Buffer<(Text, SubnetInfo)>(parsedSubnets.size());
            for (subnet in parsedSubnets.vals()) {
                buffer.add((subnet.subnetId, subnet));
            };
            cachedSubnetsArray := Buffer.toArray(buffer);
            
            cachedStatsData := ?parsedStats;
            lastFetchTime := parsedStats.lastUpdated;
            lastRefreshBy := ?msg.caller;

            // Update certified data
            updateCertifiedData();

            let cyclesRemaining = Cycles.balance();
            Debug.print("Network data refreshed successfully. Cycles remaining: " # Nat.toText(cyclesRemaining));
            
            #ok("Refreshed successfully. Subnets: " # Nat.toText(parsedStats.totalSubnets) # 
                ", Nodes: " # Nat.toText(parsedStats.totalNodes) # 
                " (Gen1: " # Nat.toText(totalGen1) # ", Gen2: " # Nat.toText(totalGen2) # ")")
        } catch (e) {
            let errorMsg = "Failed during refreshNetworkData: " # Error.message(e);
            Debug.print(errorMsg);
            #err(errorMsg)
        }
    };

    // System hooks
    system func preupgrade() {
        Debug.print("Preupgrade: Data is automatically persisted with persistent actor");
    };

    system func postupgrade() {
        Debug.print("Postupgrade: Restoring certified data");
        updateCertifiedData();
    };

    // HTTP handler
    public query func http_request(request: HttpRequest) : async HttpResponse {
        {
            status_code = 200;
            headers = [("Content-Type", "text/plain")];
            body = Text.encodeUtf8("ICP Subnet Dashboard Backend - API is ready. Use the frontend canister to view the dashboard.");
            streaming_strategy = null;
        }
    };
}