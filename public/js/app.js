let map;
let currentMarkers = [];
let statsData = null;

document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    loadStats();
    setupEventListeners();
});

function initializeMap() {
    map = L.map('map').setView([40.7128, -74.0060], 11);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

function setupEventListeners() {
    document.getElementById('boroughFilter').addEventListener('change', applyFilters);
    document.getElementById('hourFilter').addEventListener('change', applyFilters);
    document.getElementById('tripTypeFilter').addEventListener('change', applyFilters);
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
    
    if (tabName === 'patterns') {
        loadHeatmapData();
    } else if (tabName === 'clusters') {
        generateClusters();
    } else if (tabName === 'insights') {
        loadInsights();
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        statsData = data;
        
        document.getElementById('totalTrips').textContent = data.overall.total_trips.toLocaleString();
        document.getElementById('avgDuration').textContent = Math.round(data.overall.avg_duration) + 's';
        document.getElementById('avgDistance').textContent = data.overall.avg_distance.toFixed(2) + ' km';
        document.getElementById('avgSpeed').textContent = data.overall.avg_speed.toFixed(1) + ' km/h';
        
        createBoroughChart(data.boroughs);
        createHourlyChart(data.hourly);
        
    } catch (error) {
        console.error('Error loading stats:', error);
        showError('Failed to load statistics');
    }
}

function createBoroughChart(boroughData) {
    const total = boroughData.reduce((s, b) => s + b.trip_count, 0);
    const data = [{
        values: boroughData.map(b => b.trip_count),
        labels: boroughData.map(b => b.pickup_borough),
        type: 'pie',
        textinfo: 'label+percent',
        textposition: 'outside',
        insidetextorientation: 'horizontal',
        marker: {
            colors: ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c']
        },
        hovertemplate: '%{label}<br>%{value} trips (%{percent})<extra></extra>'
    }];
    
    const layout = {
        title: '',
        font: { size: 12 },
        margin: { t: 20, b: 20, l: 20, r: 80 },
        showlegend: true,
        legend: { x: 1.02, y: 0.5 }
    };
    
    Plotly.newPlot('boroughChart', data, layout, {responsive: true});
}

function createHourlyChart(hourlyData) {
    const data = [{
        x: hourlyData.map(h => h.hour_of_day),
        y: hourlyData.map(h => h.trip_count),
        type: 'bar',
        marker: { color: '#3498db' }
    }];
    
    const layout = {
        title: '',
        xaxis: { title: 'Hour of Day' },
        yaxis: { title: 'Number of Trips' },
        font: { size: 12 },
        margin: { t: 0, b: 40, l: 40, r: 0 }
    };
    
    Plotly.newPlot('hourlyChart', data, layout, {responsive: true});
}

async function loadHeatmapData() {
    try {
        const borough = document.getElementById('boroughFilter').value;
        const hour = document.getElementById('hourFilter').value;
        
        const params = new URLSearchParams();
        if (borough) params.append('borough', borough);
        if (hour) params.append('hour', hour);
        
        const response = await fetch(`/api/heatmap?${params}`);
        const data = await response.json();
        
        displayHeatmap(data);
        
    } catch (error) {
        console.error('Error loading heatmap data:', error);
        showError('Failed to load heatmap data');
    }
}

function displayHeatmap(heatmapData) {
    currentMarkers.forEach(marker => map.removeLayer(marker));
    currentMarkers = [];
    
    if (heatmapData.length === 0) {
        showError('No data available for selected filters');
        return;
    }
    
    const maxIntensity = Math.max(...heatmapData.map(d => d.intensity));
    
    heatmapData.forEach(point => {
        const intensity = point.intensity / maxIntensity;
        const radius = Math.max(5, intensity * 20);
        const opacity = Math.max(0.3, intensity);
        
        const marker = L.circleMarker([point.lat, point.lon], {
            radius: radius,
            fillColor: getColorFromIntensity(intensity),
            color: '#fff',
            weight: 1,
            opacity: 1,
            fillOpacity: opacity
        }).addTo(map);
        
        marker.bindPopup(`
            <strong>Pickup Location</strong><br>
            Intensity: ${point.intensity} trips<br>
            Avg Duration: ${Math.round(point.avg_duration)}s<br>
            Avg Speed: ${parseFloat(point.avg_speed || 0).toFixed(1)} km/h
        `);
        
        currentMarkers.push(marker);
    });
}

function getColorFromIntensity(intensity) {
    if (intensity > 0.8) return '#e74c3c';
    if (intensity > 0.6) return '#f39c12';
    if (intensity > 0.4) return '#f1c40f';
    if (intensity > 0.2) return '#2ecc71';
    return '#3498db';
}

async function applyFilters() {
    await loadHeatmapData();
    await loadFilteredCharts();
}

async function loadFilteredCharts() {
    try {
        const borough = document.getElementById('boroughFilter').value;
        const hour = document.getElementById('hourFilter').value;
        const tripType = document.getElementById('tripTypeFilter').value;
        
        const params = new URLSearchParams();
        if (borough) params.append('borough', borough);
        if (hour) params.append('hour', hour);
        if (tripType) params.append('tripType', tripType);
        params.append('limit', '5000');
        
        const response = await fetch(`/api/trips?${params}`);
        const trips = await response.json();
        
        createDurationChart(trips);
        createSpeedDistanceChart(trips);
        
    } catch (error) {
        console.error('Error loading filtered charts:', error);
    }
}

function createDurationChart(trips) {
    const durations = trips.map(t => t.trip_duration);
    
    const data = [{
        x: durations,
        type: 'histogram',
        marker: { color: '#3498db' },
        nbinsx: 30
    }];
    
    const layout = {
        title: '',
        xaxis: { title: 'Trip Duration (seconds)' },
        yaxis: { title: 'Frequency' },
        font: { size: 12 },
        margin: { t: 0, b: 40, l: 40, r: 0 }
    };
    
    Plotly.newPlot('durationChart', data, layout, {responsive: true});
}

function createSpeedDistanceChart(trips) {
    const data = [{
        x: trips.map(t => t.distance_km),
        y: trips.map(t => t.speed_kmh),
        mode: 'markers',
        type: 'scatter',
        marker: {
            color: trips.map(t => t.trip_duration),
            colorscale: 'Viridis',
            size: 6,
            opacity: 0.7,
            colorbar: { title: 'Duration (s)' }
        }
    }];
    
    const layout = {
        title: '',
        xaxis: { title: 'Distance (km)' },
        yaxis: { title: 'Speed (km/h)' },
        font: { size: 12 },
        margin: { t: 0, b: 40, l: 40, r: 0 }
    };
    
    Plotly.newPlot('speedDistanceChart', data, layout, {responsive: true});
}

async function generateClusters() {
    try {
        const k = document.getElementById('clusterCount').value;
        const limit = document.getElementById('sampleSize').value;
        
        document.getElementById('clusterInfo').innerHTML = '<div class="loading">Generating clusters...</div>';
        
        const response = await fetch(`/api/clusters?k=${k}&limit=${limit}`);
        const data = await response.json();
        
        document.getElementById('clusterInfo').innerHTML = `
            <strong>Generated ${data.clusterCount} clusters from ${data.totalPoints} trips</strong>
        `;
        
        createClusterChart(data.clusters);
        
    } catch (error) {
        console.error('Error generating clusters:', error);
        showError('Failed to generate clusters');
    }
}

function createClusterChart(clusters) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#34495e', '#e67e22'];
    
    const traces = clusters.map((cluster, index) => ({
        x: cluster.map(point => point.lat),
        y: cluster.map(point => point.lon),
        mode: 'markers',
        type: 'scatter',
        name: `Cluster ${index + 1}`,
        marker: {
            color: colors[index % colors.length],
            size: 8,
            opacity: 0.7
        }
    }));
    
    const layout = {
        title: 'Trip Clusters by Location',
        xaxis: { title: 'Latitude' },
        yaxis: { title: 'Longitude' },
        font: { size: 12 }
    };
    
    Plotly.newPlot('clusterChart', traces, layout, {responsive: true});
}

async function loadInsights() {
    if (!statsData) {
        await loadStats();
    }
    
    createRushHourChart();
    createCrossBoroughChart();
    createSpeedPatternChart();
}

function createRushHourChart() {
    const hourlyData = statsData.hourly;
    const morningRush = hourlyData.filter(h => h.hour_of_day >= 7 && h.hour_of_day <= 9);
    const eveningRush = hourlyData.filter(h => h.hour_of_day >= 17 && h.hour_of_day <= 19);
    
    const data = [{
        x: ['Morning Rush (7-9 AM)', 'Evening Rush (5-7 PM)'],
        y: [
            morningRush.reduce((sum, h) => sum + h.trip_count, 0),
            eveningRush.reduce((sum, h) => sum + h.trip_count, 0)
        ],
        type: 'bar',
        marker: { color: ['#e74c3c', '#3498db'] }
    }];
    
    const layout = {
        title: '',
        xaxis: { title: 'Time Period' },
        yaxis: { title: 'Total Trips' },
        font: { size: 12 },
        margin: { t: 0, b: 40, l: 40, r: 0 }
    };
    
    Plotly.newPlot('rushHourChart', data, layout, {responsive: true});
}

function createCrossBoroughChart() {
    const boroughData = statsData.boroughs;
    
    const data = [{
        x: boroughData.map(b => b.pickup_borough),
        y: boroughData.map(b => b.avg_distance),
        type: 'bar',
        marker: { color: '#2ecc71' }
    }];
    
    const layout = {
        title: '',
        xaxis: { title: 'Borough' },
        yaxis: { title: 'Average Distance (km)' },
        font: { size: 12 },
        margin: { t: 0, b: 40, l: 40, r: 0 }
    };
    
    Plotly.newPlot('crossBoroughChart', data, layout, {responsive: true});
}

function createSpeedPatternChart() {
    const boroughData = statsData.boroughs;
    
    const data = [{
        x: boroughData.map(b => b.pickup_borough),
        y: boroughData.map(b => b.avg_duration / 60),
        type: 'bar',
        marker: { color: '#f39c12' }
    }];
    
    const layout = {
        title: '',
        xaxis: { title: 'Borough' },
        yaxis: { title: 'Average Duration (minutes)' },
        font: { size: 12 },
        margin: { t: 0, b: 40, l: 40, r: 0 }
    };
    
    Plotly.newPlot('speedPatternChart', data, layout, {responsive: true});
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    document.querySelectorAll('.error').forEach(err => err.remove());
    
    const main = document.querySelector('main');
    main.insertBefore(errorDiv, main.firstChild);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 5000);
}
