const { Pool } = require('pg');

// Test database connection
async function testDatabaseConnection() {
    const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'nyc_taxi_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '123456'
    };

    const pool = new Pool(dbConfig);

    try {
        console.log('Testing database connection...');
        const client = await pool.connect();
        
        // Test basic connection
        const result = await client.query('SELECT NOW()');
        console.log('Database connection successful');
        console.log('Current time:', result.rows[0].now);
        
        // Check if trips table exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'trips'
            );
        `);
        
        if (tableCheck.rows[0].exists) {
            console.log('Trips table exists');
            
            // Check row count
            const countResult = await client.query('SELECT COUNT(*) FROM trips');
            console.log('Total trips in database:', countResult.rows[0].count);
        } else {
            console.log('Trips table does not exist. Run: npm run setup-db');
        }
        
        client.release();
        
    } catch (error) {
        console.error('Database connection failed:', error.message);
        console.log('\nTroubleshooting:');
        console.log('1. Make sure PostgreSQL is running');
        console.log('2. Check your database credentials in .env file');
        console.log('3. Create the database: CREATE DATABASE nyc_taxi_db;');
    } finally {
        await pool.end();
    }
}

// Test server startup
async function testServer() {
    try {
        console.log('\nTesting server startup...');
        const app = require('./server.js');
        console.log('Server module loaded successfully');
        console.log('Run "npm start" to start the server');
    } catch (error) {
        console.error('Server startup failed:', error.message);
    }
}

// Run tests
async function runTests() {
    console.log('Running NYC Taxi Explorer Tests\n');
    
    await testDatabaseConnection();
    await testServer();
    
    console.log('\nNext Steps:');
    console.log('1. Set up PostgreSQL and create database');
    console.log('2. Copy env.example to .env and update credentials');
    console.log('3. Run: npm run setup-db');
    console.log('4. Run: npm run import-data');
    console.log('5. Run: npm start');
    console.log('6. Open http://localhost:3000');
}

if (require.main === module) {
    runTests();
}

module.exports = { testDatabaseConnection, testServer };
