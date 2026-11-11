import { query, pool } from '../config/db';
import { redis } from '../config/redis';

async function verifyStack() {
  console.log('--- STARTING CYPHRDRIVE INFRASTRUCTURE HEALTH CHECK ---\n');

  try {
    // 1. Verify Basic PostgreSQL Connectivity
    const dbTest = await query('SELECT NOW() AS current_time, version()');
    console.log('✅ [PostgreSQL] Connected. Database Time:', dbTest.rows[0].current_time);

    // 2. Verify PostGIS Extension & Spatial Query
    const spatialTest = await query(`
      SELECT 
        name,
        ST_AsText(location) as coordinates,
        ST_Distance(
          location, 
          ST_SetSRID(ST_MakePoint(13.4050, 52.5200), 4326)::geography
        ) / 1000 AS distance_from_alexanderplatz_km
      FROM branches;
    `);
    console.log('✅ [PostGIS] Spatial Engine Working. Sample Branch Distances:');
    spatialTest.rows.forEach(b => {
      console.log(`   - ${b.name}: ${parseFloat(b.distance_from_alexanderplatz_km).toFixed(2)} km from Alexanderplatz`);
    });

    // 3. Verify TimescaleDB Hypertable
    const timescaleTest = await query(`
      SELECT hypertable_name 
      FROM timescaledb_information.hypertables 
      WHERE hypertable_name = 'telemetry_logs';
    `);
    if (timescaleTest.rows.length > 0) {
      console.log('✅ [TimescaleDB] Hypertable "telemetry_logs" is initialized.');
    } else {
      throw new Error('TimescaleDB hypertable missing!');
    }

    // 4. Verify Redis Read, Write, and TTL Lock operations
    const testKey = 'cyphrdrive:healthcheck:lock';
    await redis.set(testKey, 'active_hold', 'EX', 15);
    const redisValue = await redis.get(testKey);
    const ttl = await redis.ttl(testKey);

    if (redisValue === 'active_hold' && ttl > 0) {
      console.log(`✅ [Redis] Key stored with TTL (${ttl}s remaining). Lock Manager functional.`);
    } else {
      throw new Error('Redis verification failed!');
    }

    console.log('\n🚀 ALL SYSTEMS OPERATIONAL. Database, PostGIS, TimescaleDB, and Redis are ready.\n');
  } catch (error) {
    console.error('\n❌ HEALTH CHECK FAILED:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
    await redis.quit();
  }
}

verifyStack();