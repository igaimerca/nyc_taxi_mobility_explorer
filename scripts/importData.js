const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nyc_taxi_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '123456'
};

const pool = new Pool(dbConfig);

const MILES_TO_KM = 1.60934;
const BATCH_SIZE = 2000;
const LOG_PATH = path.resolve(process.cwd(), 'logs');
const EXCLUSION_LOG = path.join(LOG_PATH, 'excluded_records.log');

let zoneMap = null;

function ensureLogDir() {
    if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true });
}

function logExclusion(reason, raw) {
    ensureLogDir();
    const line = `${new Date().toISOString()}\t${reason}\t${JSON.stringify(raw)}\n`;
    fs.appendFileSync(EXCLUSION_LOG, line);
}

function parseNum(val, def) {
    if (val === null || val === undefined || val === '') return def;
    const n = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(n) ? def : n;
}

function parseIntStrict(val, def) {
    if (val === null || val === undefined || val === '') return def;
    const n = parseInt(String(val).replace(/,/g, ''), 10);
    return isNaN(n) ? def : n;
}

function parseTimestamp(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

function getHourFromTimestamp(val) {
    if (val == null || val === '') return 0;
    const s = String(val).trim();
    const match = s.match(/^\d{4}-\d{2}-\d{2}\s(\d{1,2}):/);
    if (match) return parseInt(match[1], 10) % 24;
    const d = new Date(val);
    return isNaN(d.getTime()) ? 0 : d.getHours();
}

function getDayMonthFromTimestamp(val) {
    if (val == null || val === '') return { day: 0, month: 1 };
    const d = new Date(val);
    if (isNaN(d.getTime())) return { day: 0, month: 1 };
    return { day: d.getDay(), month: d.getMonth() + 1 };
}

async function loadZoneMap(client) {
    const res = await client.query('SELECT location_id, borough, zone, service_zone FROM zones');
    const map = new Map();
    res.rows.forEach(r => map.set(r.location_id, { borough: r.borough, zone: r.zone, service_zone: r.service_zone }));
    return map;
}

function isValidTrip(row) {
    const pu = parseIntStrict(row.PULocationID, NaN);
    const doLoc = parseIntStrict(row.DOLocationID, NaN);
    if (!zoneMap || !zoneMap.has(pu) || !zoneMap.has(doLoc)) return { ok: false, reason: 'invalid_or_unknown_zone' };
    const pickup = parseTimestamp(row.tpep_pickup_datetime);
    const dropoff = parseTimestamp(row.tpep_dropoff_datetime);
    if (!pickup || !dropoff) return { ok: false, reason: 'invalid_timestamp' };
    const durationSec = Math.round((dropoff - pickup) / 1000);
    if (durationSec < 60 || durationSec > 86400) return { ok: false, reason: 'duration_out_of_range' };
    const passengers = parseIntStrict(row.passenger_count, -1);
    if (passengers < 0 || passengers > 9) return { ok: false, reason: 'invalid_passenger_count' };
    const tripDistance = parseNum(row.trip_distance, -1);
    if (tripDistance < 0 || tripDistance > 500) return { ok: false, reason: 'trip_distance_out_of_range' };
    const fareAmount = parseNum(row.fare_amount, -1);
    if (fareAmount < 0 || fareAmount > 10000) return { ok: false, reason: 'fare_out_of_range' };
    const totalAmount = parseNum(row.total_amount, -1);
    if (totalAmount < 0 || totalAmount > 10000) return { ok: false, reason: 'total_amount_out_of_range' };
    return { ok: true, durationSec, tripDistance, fareAmount, totalAmount, pu, do: doLoc, pickup, dropoff, passengers, row };
}

function enrich(row, ctx) {
    const tipAmount = parseNum(row.tip_amount, 0);
    const totalAmount = ctx.totalAmount;
    const tipRate = totalAmount > 0 ? tipAmount / totalAmount : 0;
    const distanceKm = ctx.tripDistance * MILES_TO_KM;
    const durationHours = ctx.durationSec / 3600;
    const speedKmh = durationHours > 0 ? distanceKm / durationHours : 0;
    const farePerKm = distanceKm > 0 ? ctx.fareAmount / distanceKm : 0;
    const puZone = zoneMap.get(ctx.pu);
    const doZone = zoneMap.get(ctx.do);
    const pickupBorough = puZone ? puZone.borough : '';
    const dropoffBorough = doZone ? doZone.borough : '';
    let tripType = 'Within Borough';
    if (pickupBorough && dropoffBorough && pickupBorough !== dropoffBorough) tripType = 'Cross Borough';
    const dm = getDayMonthFromTimestamp(row.tpep_pickup_datetime);
    return {
        vendor_id: parseIntStrict(row.VendorID, null),
        tpep_pickup_datetime: ctx.pickup,
        tpep_dropoff_datetime: ctx.dropoff,
        passenger_count: ctx.passengers,
        trip_distance: ctx.tripDistance,
        rate_code_id: parseIntStrict(row.RatecodeID, null),
        store_and_fwd_flag: (row.store_and_fwd_flag || 'N').toString().trim().charAt(0) || null,
        pu_location_id: ctx.pu,
        do_location_id: ctx.do,
        payment_type: parseIntStrict(row.payment_type, null),
        fare_amount: ctx.fareAmount,
        extra: parseNum(row.extra, 0),
        mta_tax: parseNum(row.mta_tax, 0),
        tip_amount: tipAmount,
        tolls_amount: parseNum(row.tolls_amount, 0),
        improvement_surcharge: parseNum(row.improvement_surcharge, 0),
        total_amount: totalAmount,
        congestion_surcharge: parseNum(row.congestion_surcharge, 0),
        trip_duration_sec: ctx.durationSec,
        speed_kmh: Math.min(200, speedKmh),
        fare_per_km: farePerKm,
        tip_rate: tipRate,
        hour_of_day: getHourFromTimestamp(row.tpep_pickup_datetime),
        day_of_week: dm.day,
        month: dm.month,
        pickup_borough: pickupBorough,
        dropoff_borough: dropoffBorough,
        trip_type: tripType
    };
}

async function insertBatch(client, batch) {
    if (batch.length === 0) return;
    const cols = `vendor_id,tpep_pickup_datetime,tpep_dropoff_datetime,passenger_count,trip_distance,rate_code_id,
store_and_fwd_flag,pu_location_id,do_location_id,payment_type,fare_amount,extra,mta_tax,tip_amount,tolls_amount,
improvement_surcharge,total_amount,congestion_surcharge,trip_duration_sec,speed_kmh,fare_per_km,tip_rate,
hour_of_day,day_of_week,month,pickup_borough,dropoff_borough,trip_type`;
    const placeholders = batch.map((_, i) => {
        const base = i * 28;
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17},$${base+18},$${base+19},$${base+20},$${base+21},$${base+22},$${base+23},$${base+24},$${base+25},$${base+26},$${base+27},$${base+28})`;
    }).join(',');
    const values = batch.flatMap(r => [
        r.vendor_id, r.tpep_pickup_datetime, r.tpep_dropoff_datetime, r.passenger_count, r.trip_distance,
        r.rate_code_id, r.store_and_fwd_flag, r.pu_location_id, r.do_location_id, r.payment_type,
        r.fare_amount, r.extra, r.mta_tax, r.tip_amount, r.tolls_amount, r.improvement_surcharge,
        r.total_amount, r.congestion_surcharge, r.trip_duration_sec, r.speed_kmh, r.fare_per_km, r.tip_rate,
        r.hour_of_day, r.day_of_week, r.month, r.pickup_borough, r.dropoff_borough, r.trip_type
    ]);
    await client.query(
        `INSERT INTO trips (${cols.replace(/\s+/g, ' ')}) VALUES ${placeholders}`,
        values
    );
}

function findTripFile() {
    const dir = process.cwd();
    const parquets = fs.readdirSync(dir).filter(f => /yellow_tripdata.*\.parquet$/i.test(f));
    if (parquets.length) return { path: path.join(dir, parquets[0]), format: 'parquet' };
    const csvs = fs.readdirSync(dir).filter(f => /yellow_tripdata.*\.csv$/i.test(f));
    if (csvs.length) return { path: path.join(dir, csvs[0]), format: 'csv' };
    return null;
}

function rowFromParquetRecord(rec) {
    const toStr = v => v != null ? String(v) : '';
    return {
        VendorID: rec.VendorID,
        tpep_pickup_datetime: rec.tpep_pickup_datetime != null ? new Date(rec.tpep_pickup_datetime).toISOString().replace('T', ' ').slice(0, 19) : '',
        tpep_dropoff_datetime: rec.tpep_dropoff_datetime != null ? new Date(rec.tpep_dropoff_datetime).toISOString().replace('T', ' ').slice(0, 19) : '',
        passenger_count: rec.passenger_count,
        trip_distance: rec.trip_distance,
        RatecodeID: rec.RatecodeID,
        store_and_fwd_flag: toStr(rec.store_and_fwd_flag),
        PULocationID: rec.PULocationID,
        DOLocationID: rec.DOLocationID,
        payment_type: rec.payment_type,
        fare_amount: rec.fare_amount,
        extra: rec.extra,
        mta_tax: rec.mta_tax,
        tip_amount: rec.tip_amount,
        tolls_amount: rec.tolls_amount,
        improvement_surcharge: rec.improvement_surcharge,
        total_amount: rec.total_amount,
        congestion_surcharge: rec.congestion_surcharge
    };
}

async function importFromCsv(client, tripPath) {
    let processed = 0, valid = 0, invalid = 0;
    let batch = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(tripPath)
            .pipe(csv())
            .on('data', async (row) => {
                processed++;
                if (processed % 50000 === 0) console.log(`Processed ${processed}...`);
                const result = isValidTrip(row);
                if (!result.ok) {
                    invalid++;
                    if (invalid <= 5000) logExclusion(result.reason, row);
                    return;
                }
                batch.push(enrich(row, result));
                valid++;
                if (batch.length >= BATCH_SIZE) {
                    await insertBatch(client, batch);
                    batch = [];
                }
            })
            .on('end', async () => {
                if (batch.length > 0) await insertBatch(client, batch);
                resolve({ processed, valid, invalid });
            })
            .on('error', reject);
    });
}

async function importFromParquet(client, tripPath) {
    const parquet = require('parquetjs-lite');
    let processed = 0, valid = 0, invalid = 0;
    let batch = [];
    const reader = await parquet.ParquetReader.openFile(tripPath);
    const cursor = reader.getCursor();
    let record;
    while ((record = await cursor.next())) {
        processed++;
        if (processed % 50000 === 0) console.log(`Processed ${processed}...`);
        const row = rowFromParquetRecord(record);
        const result = isValidTrip(row);
        if (!result.ok) {
            invalid++;
            if (invalid <= 5000) logExclusion(result.reason, row);
            continue;
        }
        batch.push(enrich(row, result));
        valid++;
        if (batch.length >= BATCH_SIZE) {
            await insertBatch(client, batch);
            batch = [];
        }
    }
    await reader.close();
    if (batch.length > 0) await insertBatch(client, batch);
    return { processed, valid, invalid };
}

async function importData() {
    ensureLogDir();
    const found = findTripFile();
    if (!found) {
        console.error('No yellow_tripdata_*.csv or yellow_tripdata_*.parquet found in project root');
        process.exit(1);
    }
    console.log('Using trip file:', found.path, `(${found.format})`);

    const client = await pool.connect();
    try {
        zoneMap = await loadZoneMap(client);
        console.log(`Loaded ${zoneMap.size} zones for lookup`);

        const stats = found.format === 'parquet'
            ? await importFromParquet(client, found.path)
            : await importFromCsv(client, found.path);

        console.log('\nImport completed');
        console.log('Total processed:', stats.processed);
        console.log('Valid:', stats.valid);
        console.log('Excluded:', stats.invalid);
        console.log('Exclusion log:', EXCLUSION_LOG);
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    importData().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { importData, isValidTrip, enrich };
