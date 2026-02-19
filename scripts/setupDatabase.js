const { Pool } = require('pg');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nyc_taxi_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '123456'
};

const pool = new Pool(dbConfig);

async function setupDatabase() {
    try {
        console.log('Setting up NYC Taxi Database...');
        const adminPool = new Pool({
            host: dbConfig.host,
            port: dbConfig.port,
            database: 'postgres',
            user: dbConfig.user,
            password: dbConfig.password
        });
        try {
            await adminPool.query(`CREATE DATABASE ${dbConfig.database}`);
            console.log(`Database ${dbConfig.database} created`);
        } catch (e) {
            if (e.code !== '42P04') throw e;
        }
        await adminPool.end();

        const client = await pool.connect();

        await client.query(`
            CREATE TABLE IF NOT EXISTS zones (
                location_id INTEGER PRIMARY KEY,
                borough VARCHAR(50),
                zone VARCHAR(255),
                service_zone VARCHAR(50),
                centroid_lat DECIMAL(10, 7),
                centroid_lon DECIMAL(10, 7)
            )
        `);

        await client.query(`DROP TABLE IF EXISTS trips`);
        await client.query(`
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
            )
        `);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_pickup_datetime ON trips(tpep_pickup_datetime)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_trip_duration ON trips(trip_duration_sec)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_pu_location ON trips(pu_location_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_do_location ON trips(do_location_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_hour ON trips(hour_of_day)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_pickup_borough ON trips(pickup_borough)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_dropoff_borough ON trips(dropoff_borough)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_trip_type ON trips(trip_type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_total_amount ON trips(total_amount)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_trip_distance ON trips(trip_distance)`);

        console.log('Database schema created successfully');
        client.release();
        await pool.end();
    } catch (error) {
        console.error('Error setting up database:', error.message);
        throw error;
    }
}

if (require.main === module) {
    setupDatabase();
}

module.exports = { setupDatabase, pool };
