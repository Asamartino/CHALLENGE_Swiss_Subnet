#Challenge Summary

This project was part of the Decentralized ICP Subnet Dashboard challenge, which aimed to build a full-stack dApp on the Internet Computer that provides a real-time, certified view of the network’s topology and node distribution.

A key part of the challenge was to correctly classify nodes by hardware generation (Gen1 vs. Gen2). While subnet and node information can be retrieved on-chain, the hardware generation details are not part of the certified registry state.


Since the on-chain registry uses protobuf encoding (which cannot be easily decoded in Motoko) and the DFINITY dashboard was temporarily broken, I instead relied on the official Internet Computer API. The node information was obtained directly from: 👉 https://ic-api.internetcomputer.org/api/v3/swagger -> https://ic-api.internetcomputer.org/api/v3/nodes

#Expected Result

The user must provide the node topology in JSON format, such as the output of the Internet Computer API, and upload it through the app interface.

Once uploaded:

The backend canister processes and stores the nodes, computing key statistics (total nodes, subnets, Gen1/Gen2/Unknown counts).

It then updates a certified data hash, enabling cryptographic verification of frontend queries.

The frontend dashboard automatically fetches this data, displays global statistics and charts, and allows the user to browse each subnet and view the nodes it contains.

If the certification is valid, the interface shows
✅ “Data cryptographically verified by the Internet Computer.”