const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nyc_taxi_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '123456'
});

async function createDatabaseDump() {
    try {
        console.log('Creating database dump...');

        const zonesSchema = await pool.query(`
            SELECT column_name, data_type, character_maximum_length, is_nullable
            FROM information_schema.columns WHERE table_name = 'zones' ORDER BY ordinal_position
        `);
        const tripsSchema = await pool.query(`
            SELECT column_name, data_type, character_maximum_length, is_nullable
            FROM information_schema.columns WHERE table_name = 'trips' ORDER BY ordinal_position
        `);

        const zonesData = await pool.query('SELECT * FROM zones ORDER BY location_id LIMIT 500');
        const tripsData = await pool.query(`
            SELECT * FROM trips ORDER BY trip_id LIMIT 1000
        `);

        const stats = await pool.query(`
            SELECT COUNT(*) as total_trips, COUNT(DISTINCT pickup_borough) as boroughs,
                   MIN(tpep_pickup_datetime) as earliest_trip, MAX(tpep_pickup_datetime) as latest_trip,
                   AVG(trip_duration_sec) as avg_duration, AVG(trip_distance * 1.60934) as avg_distance
            FROM trips
        `);
        const s = stats.rows[0];

        function escape(v) {
            if (v == null) return 'NULL';
            return "'" + String(v).replace(/'/g, "''") + "'";
        }

        let out = `-- NYC Taxi Trip Explorer Database Dump
-- Generated: ${new Date().toISOString()}
-- Database: nyc_taxi_db

-- ZONES (from taxi_zone_lookup + taxi_zones centroids)
CREATE TABLE zones (
    location_id INTEGER PRIMARY KEY,
    borough VARCHAR(50),
    zone VARCHAR(255),
    service_zone VARCHAR(50),
    centroid_lat DECIMAL(10, 7),
    centroid_lon DECIMAL(10, 7)
);

-- TRIPS (TLC yellow_tripdata + derived features)
CREATE TABLE trips (
    trip_id BIGSERIAL PRIMARY KEY,
    vendor_id INTEGER,
    tpep_pickup_datetime TIMESTAMP NOT NULL,
    tpep_dropoff_datetime TIMESTAMP NOT NULL,
    passenger_count SMALLINT,
    trip_distance DECIMAL(8, 2),
    rate_code_id SMALLINT,
    store_and_fwd_flag CHAR(1),
    pu_location_id INTEGER REFERENCES zones(location_id),
    do_location_id INTEGER REFERENCES zones(location_id),
    payment_type SMALLINT,
    fare_amount DECIMAL(8, 2),
    extra DECIMAL(8, 2),
    mta_tax DECIMAL(8, 2),
    tip_amount DECIMAL(8, 2),
    tolls_amount DECIMAL(8, 2),
    improvement_surcharge DECIMAL(8, 2),
    total_amount DECIMAL(8, 2),
    congestion_surcharge DECIMAL(8, 2),
    trip_duration_sec INTEGER,
    speed_kmh DECIMAL(8, 2),
    fare_per_km DECIMAL(10, 4),
    tip_rate DECIMAL(5, 4),
    hour_of_day SMALLINT,
    day_of_week SMALLINT,
    month SMALLINT,
    pickup_borough VARCHAR(50),
    dropoff_borough VARCHAR(50),
    trip_type VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_trips_pickup_datetime ON trips(tpep_pickup_datetime);
CREATE INDEX idx_trips_trip_duration ON trips(trip_duration_sec);
CREATE INDEX idx_trips_pu_location ON trips(pu_location_id);
CREATE INDEX idx_trips_do_location ON trips(do_location_id);
CREATE INDEX idx_trips_hour ON trips(hour_of_day);
CREATE INDEX idx_trips_pickup_borough ON trips(pickup_borough);
CREATE INDEX idx_trips_dropoff_borough ON trips(dropoff_borough);
CREATE INDEX idx_trips_trip_type ON trips(trip_type);

-- Sample zones (${zonesData.rows.length} rows)
`;
        if (zonesData.rows.length > 0) {
            out += 'INSERT INTO zones (location_id, borough, zone, service_zone, centroid_lat, centroid_lon) VALUES\n';
            out += zonesData.rows.map(r => `(${r.location_id},${escape(r.borough)},${escape(r.zone)},${escape(r.service_zone)},${r.centroid_lat ?? 'NULL'},${r.centroid_lon ?? 'NULL'})`).join(',\n') + ';\n\n';
        }

        out += `-- Sample trips (${tripsData.rows.length} rows)\n`;
        if (tripsData.rows.length > 0) {
            const cols = Object.keys(tripsData.rows[0]).filter(k => k !== 'trip_id').join(', ');
            out += `-- Columns: ${cols}\n`;
        }

        out += `
-- Statistics
-- Total trips: ${parseInt(s.total_trips).toLocaleString()}
-- Boroughs: ${s.boroughs}
-- Date range: ${s.earliest_trip} to ${s.latest_trip}
-- Avg duration: ${s.avg_duration ? Math.round(parseFloat(s.avg_duration)) : 0} sec
-- Avg distance: ${s.avg_distance ? parseFloat(s.avg_distance).toFixed(2) : 0} km
-- End of dump
`;

        fs.writeFileSync('database_dump.sql', out);
        console.log('Database dump created: database_dump.sql');
        console.log(`Zones: ${zonesData.rows.length} sample, Trips: ${tripsData.rows.length} sample, Total trips: ${parseInt(s.total_trips).toLocaleString()}`);
    } catch (error) {
        console.error('Error creating database dump:', error);
    } finally {
        await pool.end();
    }
}

createDatabaseDump();
