const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const shapefile = require('shapefile');
const proj4 = require('proj4');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nyc_taxi_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '123456'
};

const pool = new Pool(dbConfig);

const PRJ = 'PROJCS["NAD_1983_StatePlane_New_York_Long_Island_FIPS_3104_Feet",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",984250.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-74.0],PARAMETER["Standard_Parallel_1",40.66666666666666],PARAMETER["Standard_Parallel_2",41.03333333333333],PARAMETER["Latitude_Of_Origin",40.16666666666666],UNIT["Foot_US",0.3048006096012192]]';
proj4.defs('NYLI', PRJ);

function polygonCentroid(coords) {
    const ring = coords[0];
    if (!ring || !ring.length) return null;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        if (typeof p[0] === 'number' && typeof p[1] === 'number') {
            sx += p[0];
            sy += p[1];
            n++;
        }
    }
    if (n === 0) return null;
    return [sx / n, sy / n];
}

async function loadZonesFromLookup(client, lookupPath) {
    const rows = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(lookupPath)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });
    for (const row of rows) {
        const locId = parseInt(row.LocationID, 10);
        if (isNaN(locId)) continue;
        await client.query(
            `INSERT INTO zones (location_id, borough, zone, service_zone) VALUES ($1, $2, $3, $4)
             ON CONFLICT (location_id) DO UPDATE SET borough = $2, zone = $3, service_zone = $4`,
            [
                locId,
                (row.Borough || '').trim(),
                (row.Zone || '').trim(),
                (row.service_zone || '').trim()
            ]
        );
    }
    return rows.length;
}

async function updateCentroidsFromShapefile(client, shpPath, dbfPath) {
    const centroids = [];
    const source = await shapefile.open(shpPath, dbfPath);
    let result = await source.read();
    while (!result.done) {
        const f = result.value;
        const locId = f.properties && f.properties.LocationID != null ? parseInt(f.properties.LocationID, 10) : null;
        if (locId == null || !f.geometry || !f.geometry.coordinates) {
            result = await source.read();
            continue;
        }
        const xy = polygonCentroid(f.geometry.coordinates);
        if (xy) {
            const [lon, lat] = proj4('NYLI', 'WGS84', xy);
            centroids.push({ location_id: locId, lat, lon });
        }
        result = await source.read();
    }
    for (const c of centroids) {
        await client.query(
            `UPDATE zones SET centroid_lat = $1, centroid_lon = $2 WHERE location_id = $3`,
            [c.lat, c.lon, c.location_id]
        );
    }
    return centroids.length;
}

async function run() {
    const lookupPath = path.resolve(process.cwd(), 'taxi_zone_lookup.csv');
    const shpPath = path.resolve(process.cwd(), 'taxi_zones', 'taxi_zones.shp');
    const dbfPath = path.resolve(process.cwd(), 'taxi_zones', 'taxi_zones.dbf');

    if (!fs.existsSync(lookupPath)) {
        console.error('taxi_zone_lookup.csv not found in project root');
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        await client.query('DELETE FROM zones');
        const count = await loadZonesFromLookup(client, lookupPath);
        console.log(`Loaded ${count} zones from taxi_zone_lookup.csv`);

        if (fs.existsSync(shpPath) && fs.existsSync(dbfPath)) {
            const updated = await updateCentroidsFromShapefile(client, shpPath, dbfPath);
            console.log(`Updated ${updated} zone centroids from taxi_zones shapefile`);
        } else {
            console.log('taxi_zones shapefile not found; zone centroids left null');
        }
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
