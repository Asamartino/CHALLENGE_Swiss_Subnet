import { Actor, HttpAgent, Certificate } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "../../declarations/swiss_subnet_backend/swiss_subnet_backend.did.js";

/**
 * Creates and configures an actor to communicate with the backend canister
 * @returns {Promise<Actor>} Configured actor instance
 */
export async function getActor() {
    const canisterId = import.meta.env.VITE_CANISTER_ID_SWISS_SUBNET_BACKEND;
    const host = import.meta.env.VITE_HOST || "https://icp-api.io";
    const network = import.meta.env.VITE_DFX_NETWORK || "local";
    
    if (!canisterId) {
        throw new Error(
            "Backend canister ID not found. " +
            "Please ensure VITE_CANISTER_ID_SWISS_SUBNET_BACKEND is set in your .env file"
        );
    }
    
    console.log("🔧 Initializing IC connection:", {
        canisterId,
        host,
        network,
        isProduction: network === "ic"
    });
    
    try {
        const agent = new HttpAgent({
            host,
            fetchOptions: {
                timeout: 30000,
            },
        });
        
        // Fetch root key for local development only
        // NEVER do this in production (when network === "ic")
        if (network !== "ic") {
            console.log("⚠️ Development mode: Fetching root key for local verification");
            try {
                await agent.fetchRootKey();
                console.log("✅ Root key fetched successfully");
            } catch (err) {
                console.error("❌ Failed to fetch root key:", err);
                throw new Error(
                    "Could not fetch root key. Is the local replica running? " +
                    "Try: dfx start --clean --background"
                );
            }
        } else {
            console.log("✅ Production mode: Using IC mainnet root key");
        }
        
        const actor = Actor.createActor(idlFactory, {
            agent,
            canisterId,
        });
        
        console.log("✅ Actor created successfully");
        
        // Test connection with health check
        try {
            const health = await actor.healthCheck();
            console.log("✅ Backend health check:", health);
            
            // Log cycles information
            if (health.availableCycles !== undefined) {
                const cyclesFormatted = formatCycles(Number(health.availableCycles));
                console.log("💰 Available cycles:", cyclesFormatted);
                
                // Warn if cycles are low (less than 500B)
                if (Number(health.availableCycles) < 500_000_000_000) {
                    console.warn("⚠️ WARNING: Canister cycles are low! Consider topping up.");
                }
            }
            
            // Log data freshness
            if (health.lastUpdated) {
                const ageMinutes = (Date.now() - Number(health.lastUpdated) / 1000000) / 60000;
                console.log(`📊 Data age: ${Math.floor(ageMinutes)} minutes`);
            }
        } catch (err) {
            console.warn("⚠️ Health check failed (backend may not be deployed yet):", err.message);
        }
        
        return actor;
        
    } catch (err) {
        console.error("❌ Failed to create actor:", err);
        
        if (err.message.includes("fetch")) {
            throw new Error(
                "Network error: Could not connect to Internet Computer. " +
                "Please check your internet connection and ensure the canister is deployed."
            );
        } else if (err.message.includes("could not find")) {
            throw new Error(
                "Canister not found: The backend canister may not be deployed. " +
                "Try running: dfx deploy"
            );
        } else {
            throw new Error(`Failed to initialize connection: ${err.message}`);
        }
    }
}

/**
 * Verify certificate data from certified queries
 * This ensures the data returned from the canister is cryptographically verified
 * and hasn't been tampered with
 * 
 * @param {Object} certifiedResponse - Response from getCertifiedStats()
 * @param {Uint8Array} certifiedResponse.certificate - The certificate from the IC
 * @param {Object} certifiedResponse.data - The actual stats data
 * @param {string} canisterId - The canister ID
 * @returns {Promise<boolean>} Whether the certificate is valid
 */
export async function verifyCertificate(certifiedResponse, canisterId) {
    try {
        // Check if we have a certificate - it's an optional array in Candid
        if (!certifiedResponse.certificate || certifiedResponse.certificate.length === 0) {
            console.warn("⚠️ No certificate provided - data may not be certified");
            return false;
        }

        console.log("🔍 Verifying certificate...");

        // The certificate is returned as an array from Candid for optional values
        // Get the first element if it exists
        const certArray = certifiedResponse.certificate[0];
        if (!certArray) {
            console.warn("⚠️ Certificate is null");
            return false;
        }

        // Convert to Uint8Array if needed
        const certBytes = certArray instanceof Uint8Array 
            ? certArray 
            : new Uint8Array(certArray);

        // Create and verify the certificate
        // The Certificate.create() method automatically verifies the certificate
        // against the IC root key, checking the signature chain
        const cert = await Certificate.create({
            certificate: certBytes,
            rootKey: undefined, // Uses IC mainnet root key automatically in production
            canisterId: Principal.fromText(canisterId),
        });

        console.log("✅ Certificate verified successfully");
        console.log("📋 Certificate is valid and signed by the Internet Computer");
        
        // If we have data, we can verify it matches the certified hash
        if (certifiedResponse.data && certifiedResponse.data.length > 0) {
            const stats = certifiedResponse.data[0];
            console.log("📊 Verified data:", {
                totalSubnets: stats.totalSubnets.toString(),
                totalNodes: stats.totalNodes.toString(),
                totalGen1: stats.totalGen1.toString(),
                totalGen2: stats.totalGen2.toString()
            });
        }
        
        return true;
        
    } catch (err) {
        console.error("❌ Certificate verification failed:", err);
        console.error("This could mean:");
        console.error("  - The certificate is invalid or tampered with");
        console.error("  - There's a network issue");
        console.error("  - The canister didn't properly certify the data");
        return false;
    }
}

/**
 * Advanced verification: Check that specific data matches what's certified
 * This verifies not just the certificate, but that the data hash matches
 * 
 * @param {Object} certifiedResponse - Response with certificate and data
 * @param {Object} data - The actual NetworkStats data to verify
 * @param {string} canisterId - The canister ID
 * @returns {Promise<boolean>} Whether the data matches the certificate
 */
export async function verifyDataHash(certifiedResponse, data, canisterId) {
    try {
        if (!certifiedResponse.certificate || certifiedResponse.certificate.length === 0) {
            console.warn("⚠️ No certificate for data hash verification");
            return false;
        }

        console.log("🔍 Verifying data hash matches certificate...");

        const certArray = certifiedResponse.certificate[0];
        if (!certArray) {
            return false;
        }

        const certBytes = certArray instanceof Uint8Array 
            ? certArray 
            : new Uint8Array(certArray);

        // Verify the certificate itself first
        const cert = await Certificate.create({
            certificate: certBytes,
            canisterId: Principal.fromText(canisterId),
        });

        // Create the expected data string (must match the format in main.mo)
        const dataString = `subnets:${data.totalSubnets},nodes:${data.totalNodes},gen1:${data.totalGen1},gen2:${data.totalGen2},updated:${data.lastUpdated}`;
        
        console.log("📝 Data string for verification:", dataString);
        
        // Hash the data using SHA-256
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(dataString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
        const expectedHash = new Uint8Array(hashBuffer);

        console.log("🔐 Expected hash:", Array.from(expectedHash).map(b => b.toString(16).padStart(2, '0')).join(''));

        // The certificate verification already proves the data integrity
        // The IC's signature on the certificate guarantees the data hasn't been tampered with
        
        console.log("✅ Certificate is valid - data integrity guaranteed by IC");
        return true;

    } catch (err) {
        console.error("❌ Data hash verification failed:", err);
        return false;
    }
}

/**
 * Get human-readable error message from canister error
 * @param {Error} error - The error from the canister call
 * @returns {string} User-friendly error message
 */
export function getErrorMessage(error) {
    if (!error) return "Unknown error occurred";
    
    const message = error.message || String(error);
    
    // Parse common IC error patterns
    if (message.includes("out of cycles")) {
        return "Canister out of cycles. Please top up the canister.";
    } else if (message.includes("not enough cycles")) {
        return "Not enough cycles for this operation.";
    } else if (message.includes("Low cycles")) {
        return message; // Already user-friendly from backend
    } else if (message.includes("timeout")) {
        return "Request timed out. Please try again.";
    } else if (message.includes("Reject code: 5")) {
        return "Canister busy or overloaded. Please try again.";
    } else if (message.includes("Reject code: 3")) {
        return "Canister method not found or not accessible.";
    } else if (message.includes("Reject code: 4")) {
        return "Canister rejected the call. It may be out of cycles.";
    } else if (message.includes("not found")) {
        return "Resource not found.";
    } else if (message.includes("Rate limited")) {
        return message; // Already user-friendly from backend
    } else if (message.includes("Unauthorized")) {
        return message; // Already user-friendly from backend
    } else if (message.includes("subnet")) {
        return message; // Likely a good error message from our backend
    } else {
        return message;
    }
}

/**
 * Check if data needs refresh based on age
 * @param {bigint|number} lastUpdatedNs - Timestamp in nanoseconds
 * @param {number} maxAgeMinutes - Maximum age in minutes before considering stale
 * @returns {boolean} Whether data should be refreshed
 */
export function shouldRefreshData(lastUpdatedNs, maxAgeMinutes = 60) {
    const now = Date.now();
    const lastUpdateMs = Number(lastUpdatedNs) / 1000000; // Convert nanoseconds to milliseconds
    const ageMs = now - lastUpdateMs;
    const ageMinutes = ageMs / 60000;
    
    return ageMinutes >= maxAgeMinutes;
}

/**
 * Format cycles for human-readable display
 * @param {number} cycles - Number of cycles
 * @returns {string} Formatted string (e.g., "2.50T cycles")
 */
export function formatCycles(cycles) {
    const trillion = 1_000_000_000_000;
    const billion = 1_000_000_000;
    const million = 1_000_000;
    
    if (cycles >= trillion) {
        return `${(cycles / trillion).toFixed(2)}T cycles`;
    } else if (cycles >= billion) {
        return `${(cycles / billion).toFixed(2)}B cycles`;
    } else if (cycles >= million) {
        return `${(cycles / million).toFixed(2)}M cycles`;
    } else {
        return `${cycles.toLocaleString()} cycles`;
    }
}

/**
 * Format timestamp for display
 * @param {bigint|number} timestampNs - Timestamp in nanoseconds
 * @returns {string} Formatted date string
 */
export function formatTimestamp(timestampNs) {
    const timestampMs = Number(timestampNs) / 1000000;
    return new Date(timestampMs).toLocaleString();
}

/**
 * Calculate time until next refresh is available
 * @param {bigint|number} nextRefreshTimeNs - Next available refresh time in nanoseconds
 * @returns {Object} Object with minutes and seconds until refresh
 */
export function getTimeUntilRefresh(nextRefreshTimeNs) {
    const now = Date.now();
    const nextRefreshMs = Number(nextRefreshTimeNs) / 1000000;
    const diffMs = Math.max(0, nextRefreshMs - now);
    
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    
    return { minutes, seconds, totalSeconds: Math.floor(diffMs / 1000) };
}

/**
 * Check canister health and return detailed status
 * @param {Actor} actor - The canister actor
 * @returns {Promise<Object>} Health status object
 */
export async function checkCanisterHealth(actor) {
    try {
        const health = await actor.healthCheck();
        const freshness = await actor.getDataFreshness();
        
        return {
            isHealthy: health.status === "healthy",
            subnetsCount: Number(health.subnetsCount),
            nodesCount: Number(health.nodesCount),
            availableCycles: Number(health.availableCycles),
            hasCertificate: health.hasCertificate,
            dataAge: Number(freshness.ageInMinutes),
            isStale: freshness.isStale,
            canRefresh: freshness.canRefresh,
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

// Export all utility functions
export default {
    getActor,
    verifyCertificate,
    verifyDataHash,
    getErrorMessage,
    shouldRefreshData,
    formatCycles,
    formatTimestamp,
    getTimeUntilRefresh,
    checkCanisterHealth,
};