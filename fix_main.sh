#!/bin/bash

# Fix 1: Make userRefreshHistory stable-compatible
sed -i '142s/.*/    stable var userRefreshHistoryEntries : [(Principal, Int)] = [];\n    var userRefreshHistory : HashMap.HashMap<Principal, Int> = HashMap.HashMap(10, Principal.equal, Principal.hash);/' src/swiss_subnet_backend/main.mo

# Fix 2: Change return type of fetchNodeMetrics
sed -i 's/async Result\.Result<HashMap\.HashMap<Text, NodeGeneration>, Text>/async Result.Result<[(Text, NodeGeneration)], Text>/g' src/swiss_subnet_backend/main.mo

# Fix 3: Fix the return statements in fetchNodeMetrics and fetchNodeProviderClassification
sed -i 's/#ok(nodeMap)/#ok(Iter.toArray(nodeMap.entries()))/g' src/swiss_subnet_backend/main.mo

# Fix 4: Update the preupgrade function
sed -i '/system func preupgrade/,/};/c\
    system func preupgrade() {\
        userRefreshHistoryEntries := Iter.toArray(userRefreshHistory.entries());\
        Debug.print("Preupgrade: Data is automatically persisted with persistent actor");\
    };' src/swiss_subnet_backend/main.mo

# Fix 5: Update the postupgrade function  
sed -i '/system func postupgrade/,/};/c\
    system func postupgrade() {\
        userRefreshHistory := HashMap.fromIter<Principal, Int>(\
            userRefreshHistoryEntries.vals(),\
            10,\
            Principal.equal,\
            Principal.hash\
        );\
        userRefreshHistoryEntries := [];\
        Debug.print("Postupgrade: Restoring certified data");\
        updateCertifiedData();\
    };' src/swiss_subnet_backend/main.mo

echo "Fixes applied!"
