# NYC Taxi Trip Explorer

A web application for exploring and analyzing NYC taxi trip data patterns using Node.js, Express.js, and PostgreSQL.

## Features

- Interactive dashboard with trip pattern visualizations
- Filtering by borough, time, duration, and trip type
- Geographic heatmap of pickup locations
- Custom K-means clustering for trip analysis
- Statistical insights and data exploration
- Responsive web interface

## Video Walkthrough

**5-Minute Demo Video**: [Watch the application walkthrough](https://jumpshare.com/share/x43IKwaG1r1MkYzYzHTR)

This video demonstrates the system architecture, 
custom K-means clustering algorithm, interactive features, and key insights from the NYC taxi data analysis.

## Download Files

**Technical Report**: [TECHNICAL_REPORT.pdf](TECHNICAL_REPORT.pdf) - Complete technical documentation and analysis

**Archicture Diagram**: [Architecture_Diagram.png](Architecture_Diagram.png)

**Submission Package**: [nyc_taxi_explorer_submission.zip](nyc_taxi_explorer_submission.zip) - Complete codebase ready for submission


## Dataset

This application uses the official NYC TLC (Taxi & Limousine Commission) data:

- **yellow_tripdata** (Fact): Trip-level records (timestamps, trip_distance, PULocationID, DOLocationID, fare_amount, total_amount, etc.). Place `yellow_tripdata_YYYY-MM.csv` (or `.parquet`) in the project root.
- **taxi_zone_lookup.csv** (Dimension): LocationID → Borough, Zone, service_zone. Place in project root.
- **taxi_zones/** (Spatial): Shapefile with zone boundaries; used to compute zone centroids for maps. Place the `taxi_zones` folder (`.shp`, `.dbf`, `.prj`, etc.) in project root.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (HTML/CSS/JS) │◄──►│   (Express.js)  │◄──►│   (PostgreSQL)  │
│                 │    │                 │    │                 │
│ • Interactive   │    │ • REST API      │    │ • Normalized    │
│   Dashboard     │    │ • Data Cleaning │    │   Schema        │
│ • Visualizations│    │ • Custom        │    │ • Indexing      │
│ • Filtering     │    │   Algorithms    │    │ • Performance   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Technology Stack

### Backend
- Node.js - Runtime environment
- Express.js - Web framework
- PostgreSQL - Database
- pg - PostgreSQL client

### Frontend
- HTML/CSS/JavaScript - User interface
- Plotly.js - Data visualizations
- Leaflet - Interactive maps

### Data Processing
- Custom K-means algorithm for trip clustering
- Geographic analysis for borough detection
- Statistical processing for data cleaning

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn package manager

## Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/igaimerca/nyc_taxi_mobility_explorer
cd nyc_taxi_mobility_explorer
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Database Setup

#### Install PostgreSQL
```bash
# macOS
brew install postgresql
brew services start postgresql

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

#### Create Database and User
```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE nyc_taxi_db;
CREATE USER taxi_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nyc_taxi_db TO taxi_user;
\q
```

### 4. Environment Configuration
Create a `.env` file in the root directory:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nyc_taxi_db
DB_USER=taxi_user
DB_PASSWORD=your_password
PORT=3000
```

### 5. Database Schema Setup
```bash
npm run setup-db
```

### 6. Import Zones (taxi_zone_lookup + taxi_zones centroids)
```bash
npm run import-zones
```

### 7. Data Import (yellow_tripdata)
```bash
npm run import-data
```

Ensure `yellow_tripdata_*.csv` (or parquet) and `taxi_zone_lookup.csv` are in the project root. Excluded records are logged to `logs/excluded_records.log`. Import may take several minutes depending on file size.

### 8. Start the Application
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Project Structure

```
nyc_taxi_mobility_explorer/
├── public/
│   ├── css/
│   │   └── style.css          # Main stylesheet
│   ├── js/
│   │   └── app.js             # Frontend JavaScript
│   └── index.html             # Main dashboard
├── scripts/
│   ├── setupDatabase.js       # Database schema (zones + trips)
│   ├── importZones.js         # Load taxi_zone_lookup + zone centroids from shapefile
│   ├── importData.js          # Clean and import yellow_tripdata (CSV)
│   └── createDump.js          # Generate database_dump.sql
├── server.js                  # Express.js server
├── package.json               # Dependencies and scripts
└── README.md                  # This file
```

## API Endpoints

### Statistics
- `GET /api/stats` - Overall trip statistics and borough data

### Trip Data
- `GET /api/trips` - Filtered trip data with pagination
  - Query parameters: `limit`, `offset`, `borough`, `hour`, `minDuration`, `maxDuration`, `tripType`

### Clustering
- `GET /api/clusters` - Custom K-means clustering results
  - Query parameters: `k` (number of clusters), `limit` (sample size)

### Heatmap
- `GET /api/heatmap` - Geographic heatmap data
  - Query parameters: `hour`, `borough`

## Custom Algorithm Implementation

### K-Means Clustering Algorithm

The application implements a custom K-means clustering algorithm for analyzing trip patterns:

**Features:**
- Manual implementation without external libraries
- Multi-dimensional clustering (latitude, longitude, duration)
- Custom distance calculation
- Convergence detection
- Time complexity: O(n * k * i) where n=points, k=clusters, i=iterations

**Algorithm Steps:**
1. Initialize k centroids randomly
2. Assign each point to nearest centroid
3. Update centroids based on cluster means
4. Repeat until convergence or max iterations

## Key Insights

### 1. Rush Hour Patterns
- Morning rush (7-9 AM) shows higher trip density in business districts
- Evening rush (5-7 PM) exhibits more distributed patterns across boroughs

### 2. Cross-Borough Mobility
- Manhattan serves as the primary hub for cross-borough trips
- Average trip distances vary significantly by borough
- Brooklyn-Queens trips show unique mobility patterns

### 3. Speed Patterns by Location
- Manhattan trips have lower average speeds due to traffic density
- Outer boroughs show higher speeds and longer durations
- Airport trips (JFK/LGA) exhibit distinct speed characteristics

## Data Processing Pipeline

### Data Cleaning
- **Coordinate Validation**: Filter trips outside NYC boundaries
- **Duration Filtering**: Remove trips < 30s or > 3 hours
- **Passenger Validation**: Filter invalid passenger counts
- **Distance Validation**: Remove trips with unrealistic distances

### Feature Engineering
- **Distance Calculation**: Haversine formula for accurate distances
- **Speed Calculation**: Distance/time-based speed computation
- **Borough Detection**: Geographic boundary-based classification
- **Trip Classification**: Within-borough vs cross-borough trips
- **Temporal Features**: Hour, day, month extraction

### Data Quality
- **Outlier Detection**: Statistical methods for anomaly identification
- **Missing Value Handling**: Appropriate imputation strategies
- **Duplicate Removal**: Trip deduplication based on key attributes

## Database Schema

**zones** (from taxi_zone_lookup + taxi_zones): `location_id` (PK), `borough`, `zone`, `service_zone`, `centroid_lat`, `centroid_lon`.

**trips** (TLC yellow_tripdata + derived features): `trip_id` (PK), vendor_id, tpep_pickup_datetime, tpep_dropoff_datetime, passenger_count, trip_distance, rate_code_id, store_and_fwd_flag, pu_location_id (FK → zones), do_location_id (FK → zones), payment_type, fare_amount, extra, mta_tax, tip_amount, tolls_amount, improvement_surcharge, total_amount, congestion_surcharge, **trip_duration_sec**, **speed_kmh**, **fare_per_km**, **tip_rate**, hour_of_day, day_of_week, month, pickup_borough, dropoff_borough, trip_type.

Derived features (justified in report): trip_duration_sec (from timestamps), speed_kmh (trip_distance/duration), fare_per_km, tip_rate (tip_amount/total_amount), trip_type (Within/Cross Borough).

### Indexes
- idx_trips_pickup_datetime, idx_trips_trip_duration, idx_trips_pu_location, idx_trips_do_location, idx_trips_hour, idx_trips_pickup_borough, idx_trips_dropoff_borough, idx_trips_trip_type

## Performance Optimizations

- **Database Indexing**: Strategic indexes for common query patterns
- **Batch Processing**: Efficient data import with batching
- **Query Optimization**: Optimized SQL queries with proper joins
- **Frontend Caching**: Client-side data caching for better UX
- **Pagination**: Large dataset handling with offset-based pagination

## Testing

### Manual Testing Checklist
- [ ] Database connection and schema creation
- [ ] Data import process completion
- [ ] API endpoint functionality
- [ ] Frontend visualization rendering
- [ ] Filter and search operations
- [ ] Clustering algorithm execution
- [ ] Responsive design on different screen sizes

## Troubleshooting

### Common Issues

**Database Connection Error**
```bash
# Check PostgreSQL status
brew services list | grep postgresql
# Restart if needed
brew services restart postgresql
```

**Data Import Fails**
- Ensure `taxi_zone_lookup.csv` and `yellow_tripdata_*.csv` are in the project root.
- Run `npm run import-zones` before `npm run import-data`.
- Check `logs/excluded_records.log` for exclusion reasons.

**Memory Issues During Import**
- Reduce batch size in `importData.js`
- Increase Node.js memory limit: `node --max-old-space-size=4096 scripts/importData.js`

## Performance Metrics

- **Data Processing**: ~1.4M records processed
- **Import Time**: 10-15 minutes (varies by hardware)
- **Query Response**: < 200ms for most operations
- **Memory Usage**: ~500MB during data import
- **Database Size**: ~800MB for processed dataset

## License

This project is licensed under the MIT License.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For questions or issues:
- Create an issue in the repository
- Check the troubleshooting section
- Review the API documentation

---

This application is designed for educational purposes.
