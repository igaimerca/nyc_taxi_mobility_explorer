require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nyc_taxi_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '123456'
};

const pool = new Pool(dbConfig);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

class TripClusterer {
    constructor() {
        this.clusters = [];
    }
    
    kMeans(data, k, maxIterations = 100) {
        if (data.length === 0) return [];
        if (k <= 0 || k > data.length) return [data];
        
        let centroids = this.initializeCentroids(data, k);
        let clusters = [];
        
        for (let iteration = 0; iteration < maxIterations; iteration++) {
            clusters = Array(k).fill().map(() => []);
            
            data.forEach(point => {
                const distances = centroids.map(centroid => 
                    this.calculateDistance(point, centroid)
                );
                const nearestIndex = distances.indexOf(Math.min(...distances));
                if (nearestIndex >= 0 && nearestIndex < clusters.length) {
                    clusters[nearestIndex].push(point);
                }
            });
            
            const newCentroids = clusters.map((cluster, index) => {
                if (cluster.length === 0) {
                    const randomIndex = Math.floor(Math.random() * data.length);
                    return { ...data[randomIndex] };
                }
                
                const avgLat = cluster.reduce((sum, p) => sum + parseFloat(p.lat), 0) / cluster.length;
                const avgLon = cluster.reduce((sum, p) => sum + parseFloat(p.lon), 0) / cluster.length;
                const avgDuration = cluster.reduce((sum, p) => sum + parseFloat(p.duration), 0) / cluster.length;
                
                return { lat: avgLat, lon: avgLon, duration: avgDuration };
            });
            
            const converged = centroids.every((centroid, i) => 
                this.calculateDistance(centroid, newCentroids[i]) < 0.001
            );
            
            if (converged) break;
            
            centroids = newCentroids;
        }
        
        return clusters.filter(cluster => cluster.length > 0);
    }
    
    initializeCentroids(data, k) {
        const centroids = [];
        const usedIndices = new Set();
        
        for (let i = 0; i < k; i++) {
            let randomIndex;
            do {
                randomIndex = Math.floor(Math.random() * data.length);
            } while (usedIndices.has(randomIndex));
            
            usedIndices.add(randomIndex);
            centroids.push({ ...data[randomIndex] });
        }
        
        return centroids;
    }
    
    calculateDistance(point1, point2) {
        if (!point1 || !point2) return Infinity;
        
        const lat1 = parseFloat(point1.lat) || 0;
        const lat2 = parseFloat(point2.lat) || 0;
        const lon1 = parseFloat(point1.lon) || 0;
        const lon2 = parseFloat(point2.lon) || 0;
        const dur1 = parseFloat(point1.duration) || 0;
        const dur2 = parseFloat(point2.duration) || 0;
        
        const latDiff = lat1 - lat2;
        const lonDiff = lon1 - lon2;
        const durationDiff = (dur1 - dur2) / 1000;
        
        return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff + durationDiff * durationDiff);
    }
}

app.get('/api/stats', async (req, res) => {
    try {
        const client = await pool.connect();
        
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_trips,
                AVG(trip_duration_sec) as avg_duration,
                AVG(trip_distance * 1.60934) as avg_distance,
                AVG(speed_kmh) as avg_speed,
                MIN(tpep_pickup_datetime) as earliest_trip,
                MAX(tpep_pickup_datetime) as latest_trip
            FROM trips
        `);
        
        const boroughStats = await client.query(`
            SELECT 
                pickup_borough,
                COUNT(*) as trip_count,
                AVG(trip_duration_sec) as avg_duration,
                AVG(trip_distance * 1.60934) as avg_distance
            FROM trips 
            WHERE pickup_borough IS NOT NULL AND pickup_borough != ''
            GROUP BY pickup_borough
            ORDER BY trip_count DESC
        `);
        
        const hourlyStats = await client.query(`
            SELECT 
                hour_of_day,
                COUNT(*) as trip_count,
                AVG(trip_duration_sec) as avg_duration,
                AVG(speed_kmh) as avg_speed
            FROM trips
            GROUP BY hour_of_day
            ORDER BY hour_of_day
        `);
        
        client.release();
        
        const overall = stats.rows[0];
        const processedOverall = {
            total_trips: parseInt(overall.total_trips),
            avg_duration: parseFloat(overall.avg_duration),
            avg_distance: parseFloat(overall.avg_distance),
            avg_speed: parseFloat(overall.avg_speed),
            earliest_trip: overall.earliest_trip,
            latest_trip: overall.latest_trip
        };
        
        const processedBoroughs = boroughStats.rows.map(row => ({
            pickup_borough: row.pickup_borough,
            trip_count: parseInt(row.trip_count),
            avg_duration: parseFloat(row.avg_duration),
            avg_distance: parseFloat(row.avg_distance)
        }));
        
        const processedHourly = hourlyStats.rows.map(row => ({
            hour_of_day: parseInt(row.hour_of_day),
            trip_count: parseInt(row.trip_count),
            avg_duration: parseFloat(row.avg_duration),
            avg_distance: parseFloat(row.avg_distance)
        }));
        
        res.json({
            overall: processedOverall,
            boroughs: processedBoroughs,
            hourly: processedHourly
        });
        
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

app.get('/api/trips', async (req, res) => {
    try {
        const { 
            limit = 1000, 
            offset = 0, 
            borough, 
            hour, 
            minDuration, 
            maxDuration,
            tripType 
        } = req.query;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramCount = 0;
        
        if (borough) {
            paramCount++;
            whereClause += ` AND pickup_borough = $${paramCount}`;
            params.push(borough);
        }
        
        if (hour !== undefined) {
            paramCount++;
            whereClause += ` AND hour_of_day = $${paramCount}`;
            params.push(parseInt(hour));
        }
        
        if (minDuration) {
            paramCount++;
            whereClause += ` AND trip_duration_sec >= $${paramCount}`;
            params.push(parseInt(minDuration));
        }
        
        if (maxDuration) {
            paramCount++;
            whereClause += ` AND trip_duration_sec <= $${paramCount}`;
            params.push(parseInt(maxDuration));
        }
        
        if (tripType) {
            paramCount++;
            whereClause += ` AND trip_type = $${paramCount}`;
            params.push(tripType);
        }
        
        paramCount++;
        params.push(parseInt(limit));
        paramCount++;
        params.push(parseInt(offset));
        
        const client = await pool.connect();
        
        const trips = await client.query(`
            SELECT trip_id, vendor_id, tpep_pickup_datetime as pickup_datetime, tpep_dropoff_datetime as dropoff_datetime,
                   passenger_count, trip_distance, (trip_distance * 1.60934) as distance_km, trip_duration_sec as trip_duration,
                   speed_kmh, fare_per_km, hour_of_day, day_of_week, month, pickup_borough, dropoff_borough, trip_type
            FROM trips 
            ${whereClause}
            ORDER BY tpep_pickup_datetime DESC
            LIMIT $${paramCount - 1} OFFSET $${paramCount}
        `, params);
        
        client.release();
        
        res.json(trips.rows);
        
    } catch (error) {
        console.error('Error fetching trips:', error);
        res.status(500).json({ error: 'Failed to fetch trips' });
    }
});

app.get('/api/clusters', async (req, res) => {
    try {
        const { k = 5, limit = 10000 } = req.query;
        const kValue = Math.max(1, Math.min(parseInt(k) || 5, 20));
        const limitValue = Math.max(10, Math.min(parseInt(limit) || 10000, 50000));
        
        const client = await pool.connect();
        
        const trips = await client.query(`
            SELECT 
                z.centroid_lat as lat,
                z.centroid_lon as lon,
                t.trip_duration_sec as duration,
                (t.trip_distance * 1.60934) as distance_km,
                t.speed_kmh,
                t.pickup_borough,
                t.hour_of_day
            FROM trips t
            JOIN zones z ON t.pu_location_id = z.location_id
            WHERE t.pickup_borough IS NOT NULL AND t.pickup_borough != ''
            AND z.centroid_lat IS NOT NULL AND z.centroid_lon IS NOT NULL
            LIMIT $1
        `, [limitValue]);
        
        client.release();
        
        if (trips.rows.length === 0) {
            return res.json({
                clusters: [],
                clusterCount: 0,
                totalPoints: 0
            });
        }
        
        const clusterer = new TripClusterer();
        const clusters = clusterer.kMeans(trips.rows, kValue);
        
        res.json({
            clusters: clusters,
            clusterCount: clusters.length,
            totalPoints: trips.rows.length
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate clusters' });
    }
});

app.get('/api/heatmap', async (req, res) => {
    try {
        const { hour, borough } = req.query;
        
        let whereClause = 'WHERE z.centroid_lat IS NOT NULL AND z.centroid_lon IS NOT NULL';
        const params = [];
        let paramCount = 0;
        
        if (hour !== undefined) {
            paramCount++;
            whereClause += ` AND t.hour_of_day = $${paramCount}`;
            params.push(parseInt(hour));
        }
        
        if (borough) {
            paramCount++;
            whereClause += ` AND t.pickup_borough = $${paramCount}`;
            params.push(borough);
        }
        
        const client = await pool.connect();
        
        const heatmapData = await client.query(`
            SELECT 
                z.centroid_lat as lat,
                z.centroid_lon as lon,
                COUNT(*) as intensity,
                AVG(t.trip_duration_sec) as avg_duration,
                AVG(t.speed_kmh) as avg_speed
            FROM trips t
            JOIN zones z ON t.pu_location_id = z.location_id
            ${whereClause}
            GROUP BY z.location_id, z.centroid_lat, z.centroid_lon
            HAVING COUNT(*) > 2
            ORDER BY intensity DESC
            LIMIT 500
        `, params);
        
        client.release();
        
        const processedData = heatmapData.rows.map(row => ({
            lat: parseFloat(row.lat),
            lon: parseFloat(row.lon),
            intensity: parseInt(row.intensity),
            avg_duration: parseFloat(row.avg_duration),
            avg_speed: parseFloat(row.avg_speed)
        }));
        
        res.json(processedData);
        
    } catch (error) {
        console.error('Error fetching heatmap data:', error);
        res.status(500).json({ error: 'Failed to fetch heatmap data' });
    }
});

app.get('/api/zones', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query(`
            SELECT location_id, borough, zone, service_zone, centroid_lat, centroid_lon
            FROM zones ORDER BY borough, zone
        `);
        client.release();
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching zones:', error);
        res.status(500).json({ error: 'Failed to fetch zones' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Make sure PostgreSQL is running and database is set up');
});

module.exports = app;
