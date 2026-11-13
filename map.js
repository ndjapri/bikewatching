import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoibmRqYXByaSIsImEiOiJjbXdlZXNtdmgwMnJ2MndwcTE5b2k5MTVyIn0.VDey1__E8seb-VPcWGkvCA';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

const svg = d3.select('#map').select('svg');

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

function computeStationTraffic(stations, trips) {
    const departures = d3.rollup(
        trips,
        v => v.length,
        d => d.start_station_id
    );

    const arrivals = d3.rollup(
        trips,
        v => v.length,
        d => d.end_station_id
    );

    return stations.map(station => {
        const id = station.short_name;

        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;

        return station;
    });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
    if (timeFilter === -1) {
        return trips;
    }

    function withinOneHour(minutes) {
        const diff = Math.abs(minutes - timeFilter);
        return Math.min(diff, 1440 - diff) <= 60;
    }

    return trips.filter(trip => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
            withinOneHour(startedMinutes) ||
            withinOneHour(endedMinutes)
        );
    });
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

map.on('load', async () => {
    map.addSource('boston_route', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });
  
    map.addLayer({
      id: 'bike-lanes',
      type: 'line',
      source: 'boston_route',
      paint: {
        'line-color': '#32D400',
        'line-width': 5,
        'line-opacity': 0.6
      }
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
  
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 5,
            'line-opacity': 0.6
        }
    });

    // Fetch Bluebikes station data
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

        const jsonData = await d3.json(jsonurl);
        console.log('Loaded JSON Data:', jsonData);

        let stations = jsonData.data.stations;
        console.log('Stations Array:', stations);

        // Load Bluebikes traffic data
        const trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            trip => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                return trip;
            }
        );

        stations = computeStationTraffic(stations, trips);

        console.log('Stations with traffic:', stations);

        // Scale circle sizes according to traffic
        const radiusScale = d3.scaleSqrt()
            .domain([0, d3.max(stations, d => d.totalTraffic)])
            .range([0, 25]);

        const stationFlow = d3.scaleQuantize()
            .domain([0, 1])
            .range([0, 0.5, 1]);

        // Draw circles for each station
        const circles = svg
            .selectAll('circle')
            .data(stations, d => d.short_name)
            .enter()
            .append('circle')
            .attr('r', d => radiusScale(d.totalTraffic))
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.8)
            .each(function(d) {
                d3.select(this)
                    .append('title')
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            })
            .style('--departure-ratio', d =>
                stationFlow(d.totalTraffic > 0
                    ? d.departures / d.totalTraffic
                    : 0.5)
            );

        // Position circles on the map
        function updatePositions() {
            circles
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy);
        }

        updatePositions();

        // Reposition circles when the map moves
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        function updateScatterPlot(timeFilter) {
            // Filter trips based on selected time
            const filteredTrips = filterTripsByTime(trips, timeFilter);
        
            // Recalculate traffic at each station
            const filteredStations = computeStationTraffic(stations, filteredTrips);

            // Adjust circle sizes depending on filtering
            timeFilter === -1
                ? radiusScale.range([0, 25])
                : radiusScale.range([3, 50]);
        
            // Change circle sizes
            circles
                .data(filteredStations, d => d.short_name)
                .attr('r', d => radiusScale(d.totalTraffic))
                .style('--departure-ratio', d =>
                    stationFlow(d.totalTraffic > 0
                        ? d.departures / d.totalTraffic
                        : 0.5)
                )
                .select('title')
                .text(d =>
                    `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                );
        }

        // Time slider elements
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        function updateTimeDisplay() {
            const timeFilter = Number(timeSlider.value);

            if (timeFilter === -1) {
                selectedTime.textContent = '';
                anyTimeLabel.style.display = 'block';
            } else {
                selectedTime.textContent = formatTime(timeFilter);
                anyTimeLabel.style.display = 'none';
            }
            updateScatterPlot(timeFilter);
        }

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

    } catch (error) {
        console.error('Error loading JSON:', error);
    }

});