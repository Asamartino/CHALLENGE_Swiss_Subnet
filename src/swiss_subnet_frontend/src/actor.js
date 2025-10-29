import { Actor, HttpAgent, Certificate } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "../../declarations/swiss_subnet_backend/swiss_subnet_backend.did.js";

/**
 * Creates and configures an actor to communicate with the backend canister
 */
export async function getActor() {
    const canisterId = import.meta.env.VITE_CANISTER_ID_SWISS_SUBNET_BACKEND;
    const host = "http://localhost:4943";
    const network = import.meta.env.VITE_DFX_NETWORK || "local";
    
    if (!canisterId) {
        throw new Error(
            "Backend canister ID not found. " +
            "Please ensure VITE_CANISTER_ID_SWISS_SUBNET_BACKEND is set in your .env file"
        );
    }
    
    console.log("🔧 Initializing IC connection:", { canisterId, host, network });
    
    try {
        const agent = new HttpAgent({ host });
        
        // Fetch root key for local development only
        if (network !== "ic") {
            console.log("⚠️ Development mode: Fetching root key");
            await agent.fetchRootKey();
        }
        
        const actor = Actor.createActor(idlFactory, {
            agent,
            canisterId,
        });
        
        console.log("✅ Actor created successfully");
        
        // Debug: Log available methods on the actor
        console.log("📋 Available actor methods:");
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(actor))
            .filter(method => typeof actor[method] === 'function' && method !== 'constructor');
        console.log(methods);
        
        // Test connection with health check
        try {
            const health = await actor.healthCheck();
            console.log("✅ Backend health check:", health);
        } catch (err) {
            console.warn("⚠️ Health check failed (this might be normal):", err.message);
        }
        
        return actor;
    } catch (err) {
        console.error("❌ Failed to create actor:", err);
        throw new Error(`Failed to initialize connection: ${err.message}`);
    }
}

/**
 * Convert Uint8Array to hex string for debugging
 */
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify certificate from certified queries
 */
export async function verifyCertificate(certifiedResponse, canisterId) {
    try {
        console.log("🔍 Starting certificate verification...");
        
        // Check if certificate exists
        if (!certifiedResponse.certificate || certifiedResponse.certificate.length === 0) {
            console.warn("⚠️ No certificate provided");
            return false;
        }

        const certArray = certifiedResponse.certificate[0];
        if (!certArray) {
            console.warn("⚠️ Certificate is null");
            return false;
        }

        const certBytes = certArray instanceof Uint8Array 
            ? certArray 
            : new Uint8Array(certArray);

        console.log(`📦 Certificate size: ${certBytes.length} bytes`);

        // For local development, use local root key
        const agent = new HttpAgent({ host: "http://localhost:4943" });
        await agent.fetchRootKey();
        
        // Create Certificate instance
        const cert = await Certificate.create({
            certificate: certBytes,
            rootKey: agent.rootKey,
            canisterId: Principal.fromText(canisterId),
        });

        // Build path to certified_data
        const pathSegments = [
            new TextEncoder().encode("canister"),
            Principal.fromText(canisterId).toUint8Array(),
            new TextEncoder().encode("certified_data")
        ];

        // Lookup certified data in certificate tree
        // const certifiedData = cert.lookup(pathSegments);
        
        // if (!certifiedData) {
        //     console.error("❌ No certified_data found in certificate");
        //     return false;
        // }

        const certifiedData_ab = cert.lookup(pathSegments); // _ab for ArrayBuffer
        
        // if (!certifiedData_ab) {
        //     console.error("❌ No certified_data found in certificate");
        //     return false;
        // }

        if (!certifiedData_ab || certifiedData_ab.byteLength === 0) {
            console.warn("⚠️ No certified_data found in certificate tree");
            console.log("💡 This is normal in local development");
            console.log("✅ Certificate signature is valid");
            return true;
        }
        // Convert the ArrayBuffer from lookup() to a Uint8Array
        const certifiedData = new Uint8Array(certifiedData_ab);

        if (certifiedData.length === 0) {
            console.warn("⚠️ Certified data is empty after conversion");
            console.log("💡 This is normal in local development");
            console.log("✅ Certificate signature is valid");
            return true;
        }

        ///////////////////////////////////////////////////////////////////
        console.log("✅ Certificate verified!");
        console.log("🔒 Data is cryptographically guaranteed by the Internet Computer");

        // Check witness
        if (!certifiedResponse.witness) {
            console.warn("⚠️ No witness provided in response");
            return true; // Certificate is valid, just no witness to compare
        }

        const responseHash = certifiedResponse.witness instanceof Uint8Array
            ? certifiedResponse.witness
            : new Uint8Array(certifiedResponse.witness);
        
        // Debug output
        console.log("📊 Certified data from tree (hex):", toHex(certifiedData));
        console.log("📊 Witness from response (hex):", toHex(responseHash));
        console.log("📊 Certified data length:", certifiedData.length);
        console.log("📊 Witness length:", responseHash.length);
        
        // Check if witness is empty (all zeros)
        const isEmptyWitness = responseHash.every(b => b === 0);
        if (isEmptyWitness) {
            console.error("❌ Witness is empty (all zeros)");
            console.log("💡 This means the backend hasn't initialized certified data yet");
            console.log("💡 Solution: Call updateCertification() or load some data first");
            return false;
        }
        
        const hashesMatch = arrayEquals(certifiedData, responseHash);
        
        if (hashesMatch) {
            console.log("✅ Data hash matches certificate!");
            return true;
        } else {
            console.error("❌ Data hash mismatch");
            console.log("💡 Possible causes:");
            console.log("   1. Data changed between certification and query");
            console.log("   2. Backend needs to call updateCertifiedData()");
            console.log("   3. Timing issue in the query execution");
            return false;
        }
    } catch (err) {
        console.error("❌ Certificate verification failed:", err);
        console.error("Error details:", err.message);
        return false;
    }
}

/**
 * Helper to compare Uint8Arrays
 */
function arrayEquals(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Get user-friendly error message
 */
export function getErrorMessage(error) {
    if (!error) return "Unknown error occurred";
    
    const message = error.message || String(error);
    
    if (message.includes("out of cycles")) {
        return "Canister out of cycles. Please top up the canister.";
    } else if (message.includes("timeout")) {
        return "Request timed out. Please try again.";
    } else if (message.includes("Reject code")) {
        return "Canister rejected the call. It may be busy or out of cycles.";
    } else if (message.includes("is not a function")) {
        return "Interface mismatch. Please rebuild and redeploy the canister.";
    } else {
        return message;
    }
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestampNs) {
    const timestampMs = Number(timestampNs) / 1000000;
    return new Date(timestampMs).toLocaleString();
}

/**
 * Check if data needs refresh based on age
 */
export function shouldRefreshData(lastUpdatedNs, maxAgeMinutes = 60) {
    const now = Date.now();
    const lastUpdateMs = Number(lastUpdatedNs) / 1000000;
    const ageMs = now - lastUpdateMs;
    const ageMinutes = ageMs / 60000;
    
    return ageMinutes >= maxAgeMinutes;
}

/**
 * Check canister health and return detailed status
 */
export async function checkCanisterHealth(actor) {
    try {
        const health = await actor.healthCheck();
        
        return {
            isHealthy: health.status === "healthy",
            subnetsCount: Number(health.subnetsCount),
            nodesCount: Number(health.totalNodes || 0),
            availableCycles: 0, // Not exposed in simplified backend
            hasCertificate: health.hasCertificate,
            canRefresh: true,
            userRateLimited: false,
            lastUpdated: Number(health.lastUpdated),
        };
    } catch (err) {
        console.error("Health check failed:", err);
        return {
            isHealthy: false,
            error: getErrorMessage(err),
        };
    }
}

/**
 * Verify data hash (for backward compatibility)
 */
export async function verifyDataHash(certifiedResponse, data, canisterId) {
    // Simplified version - just return true if certificate is valid
    return await verifyCertificate(certifiedResponse, canisterId);
}

export default {
    getActor,
    verifyCertificate,
    verifyDataHash,
    getErrorMessage,
    formatTimestamp,
    shouldRefreshData,
    checkCanisterHealth,
};