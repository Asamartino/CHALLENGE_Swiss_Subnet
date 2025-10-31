# Challenge Summary

This project was part of the Decentralized ICP Subnet Dashboard challenge, which aimed to build a full-stack dApp on the Internet Computer that provides a real-time, certified view of the network’s topology and node distribution.

A key part of the challenge was to correctly classify nodes by hardware generation (Gen1 vs. Gen2). While subnet and node information can be retrieved on-chain, the hardware generation details are not part of the certified registry state.

As the on-chain registry relies on protobuf encoding (difficult to decode in Motoko) and the DFINITY dashboard was temporarily offline, a manual upload approach for the node and subnet topology was used.

# Expected Result

To proceed, please upload the node topology in JSON format. We recommend installing ic-admin and running: `ic-admin --nns-url https://ic0.app \ get-topology > topology.json`

Once uploaded:
- The backend canister processes and stores the nodes, computing key statistics (total nodes, subnets, Gen1/Gen2/Unknown counts).
- It then updates a certified data hash, enabling cryptographic verification of frontend queries.
- The frontend dashboard automatically fetches this data, displays global statistics and charts, and allows the user to browse each subnet and view the nodes it contains.
- If the certification is valid, the interface shows: ✅ “Data cryptographically verified by the Internet Computer.”
