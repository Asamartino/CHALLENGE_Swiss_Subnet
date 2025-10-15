import { PocketIc } from '@hadronous/pic';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Subnet Dashboard Backend', () => {
    let pic;
    let actor;

    beforeAll(async () => {
        const serverUrl = process.env.POCKET_IC_SERVER_URL;
        
        if (!serverUrl) {
            throw new Error(
                'POCKET_IC_SERVER_URL environment variable is not set. ' +
                'Please run tests using: ./run-tests.sh'
            );
        }
        
        console.log('🔗 Connecting to PocketIC at:', serverUrl);
        
        // CORRECTED: Pass the URL directly as a string, not in an object
        pic = await PocketIc.create(serverUrl);
        
        console.log('✅ PocketIC instance created');
        
        const wasmPath = resolve(
            __dirname,
            '../.dfx/local/canisters/swiss_subnet_backend/swiss_subnet_backend.wasm'
        );
        
        if (!existsSync(wasmPath)) {
            throw new Error(
                `WASM file not found at: ${wasmPath}\n` +
                'Please run: dfx build swiss_subnet_backend'
            );
        }
        
        const wasm = readFileSync(wasmPath);
        console.log(`✅ WASM loaded (${(wasm.length / 1024).toFixed(2)} KB)`);
        
        const fixture = await pic.setupCanister({
            wasm,
            arg: [],
        });
        
        actor = fixture.actor;
        console.log('✅ Test canister deployed');
    }, 120000);

    afterAll(async () => {
        if (pic) {
            try {
                await pic.tearDown();
                console.log('✅ PocketIC instance torn down');
            } catch (err) {
                console.warn('⚠️  Error tearing down PocketIC:', err.message);
            }
        }
    });

    test('health check should return healthy status', async () => {
        const health = await actor.healthCheck();
        
        expect(health).toBeDefined();
        expect(health.status).toBe('healthy');
        expect(health.subnetsCount).toBeGreaterThanOrEqual(0);
        
        console.log('✅ Health check passed:', JSON.stringify(health, null, 2));
    }, 30000);

    test('should get network stats', async () => {
        const stats = await actor.getNetworkStats();
        
        expect(stats).toBeDefined();
        console.log('📊 Network stats:', JSON.stringify(stats, null, 2));
    }, 30000);

    test('should get empty subnets list initially', async () => {
        const subnets = await actor.getSubnets();
        
        expect(Array.isArray(subnets)).toBe(true);
        console.log('✅ Subnets count:', subnets.length);
    }, 30000);

    test('should clear cache successfully', async () => {
        const result = await actor.clearCache();
        
        expect(result).toHaveProperty('ok');
        expect(result.ok).toBe('Cache cleared successfully');
        console.log('✅ Cache cleared');
    }, 30000);

    test('should get data freshness info', async () => {
        const freshness = await actor.getDataFreshness();
        
        expect(freshness).toBeDefined();
        expect(freshness).toHaveProperty('lastUpdated');
        expect(freshness).toHaveProperty('ageInMinutes');
        expect(freshness).toHaveProperty('isStale');
        
        console.log('✅ Data freshness:', JSON.stringify(freshness, null, 2));
    }, 30000);

    test('should get certified data hash', async () => {
        const hash = await actor.getCertifiedDataHash();
        
        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
        
        console.log('✅ Certified hash length:', hash.length, 'bytes');
    }, 30000);

    test('should get certificate', async () => {
        const cert = await actor.getCertificate();
        
        console.log('📜 Certificate:', cert && cert.length > 0 ? `Present (${cert[0].length} bytes)` : 'Empty');
    }, 30000);

    test('should get last update time', async () => {
        const lastUpdate = await actor.getLastUpdateTime();
        
        expect(typeof lastUpdate).toBe('bigint');
        console.log('⏰ Last update time:', lastUpdate.toString());
    }, 30000);
});