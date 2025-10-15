import { PocketIc } from '@hadronous/pic';

// Set the binary path
process.env.POCKET_IC_BIN = '/usr/local/bin/pocket-ic';

describe('Minimal PocketIC Test', () => {
    let pic;

    beforeAll(async () => {
        console.log('🚀 Creating PocketIC (library will auto-start server)...');
        console.log('   Binary:', process.env.POCKET_IC_BIN);
        
        // Let the library handle server lifecycle
        pic = await PocketIc.create();
        
        console.log('✅ PocketIC ready!');
    }, 120000);

    afterAll(async () => {
        console.log('🧹 Tearing down...');
        if (pic) {
            try {
                await pic.tearDown();
                console.log('✅ Torn down');
            } catch (err) {
                console.warn('⚠️  Warning:', err.message);
            }
        }
    }, 60000);

    test('PocketIC instance exists', async () => {
        expect(pic).toBeDefined();
        console.log('✅ Test passed!');
    }, 10000);
});