// ======================================
// script.js (D3 + GeoJSON puro, sin Leaflet)
// Con “resize listener” para re-dibujar en nuevas dimensiones
// ======================================

// Márgenes generales para gráficos
const margin = { top: 40, right: 30, bottom: 50, left: 60 };

// Mapa de colores por tipo de transporte
const typeColor = {
  0: "#1f77b4",  // Tranvía
  3: "#2ca02c",  // Bus
  5: "#d62728"   // Cable Car
};

// Variables globales
let allRouteStats = [];
let allTop10Routes = [];
let allStopDensity = [];
let allStopsList = [];
let allTop10Stops = [];
let allRouteShapes = [];
let allHourly = [];       // Datos de llegadas por hora (hourly_weekday.json)
let sfBoundaryGeo = null; // GeoJSON de SF

// Tooltip genérico (para scatter y línea)
const tooltip = d3.select("body")
  .append("div")
  .attr("class", "tooltip");

// -----------------------------
// CARGA INICIAL DE JSON + GeoJSON
// -----------------------------
Promise.all([
  d3.json("data/route_stats.json"),
  d3.json("data/top10_routes.json"),
  d3.json("data/stop_density.json"),
  d3.json("data/stops_list.json"),
  d3.json("data/top10_stops.json"),
  d3.json("data/route_shapes.json"),
  d3.json("data/hourly_weekday.json"),
  d3.json("data/sf.geojson")
]).then(([
  routeStats,
  top10Routes,
  stopDensity,
  stopsList,
  top10Stops,
  routeShapes,
  hourlyWeekday,
  sfGeo
]) => {
  // Guardamos todos los datos en variables globales
  allRouteStats    = routeStats;
  allTop10Routes   = top10Routes;
  allStopDensity   = stopDensity;
  allStopsList     = stopsList;
  allTop10Stops    = top10Stops;
  allRouteShapes   = routeShapes;
  allHourly        = hourlyWeekday;
  sfBoundaryGeo    = sfGeo;

  // Poblamos controles y tablas
  populateRouteSelector();
  populateTop10RoutesTable();
  populateTop10StopsTable();

  // Dibujamos componentes inicialmente
  drawMap();
  drawScatterplot();
  drawLineChart();

  // Eventos de filtro y botones
  d3.select("#select-route-type").on("change", () => {
    populateRouteSelector();
    drawMap();
    drawScatterplot();
    drawLineChart();
  });
  d3.select("#select-route").on("change", () => {
    drawMap();
    drawScatterplot();
    drawLineChart();
  });
  d3.select("#toggle-heatmap").on("change", () => {
    drawMap();
  });

  document.getElementById("btn-top10-rutas")
    .addEventListener("click", () => togglePanel("panel-top10-rutas"));
  document.getElementById("btn-top10-paradas")
    .addEventListener("click", () => togglePanel("panel-top10-paradas"));
  
  // Listener para redimensionar la ventana:
  window.addEventListener("resize", () => {
    drawMap();
    drawScatterplot();
    drawLineChart();
  });
}).catch(error => {
  console.error("Error al cargar JSON/GeoJSON:", error);
});

// ======================================
// HELPER: mostrar/ocultar panel colapsable
// ======================================
function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (panel.classList.contains("visible")) {
    panel.classList.remove("visible");
    panel.classList.add("hidden");
  } else {
    panel.classList.remove("hidden");
    panel.classList.add("visible");
  }
}

// ======================================
// FUNCIONES PARA POBLAR SELECT Y TABLAS
// ======================================
function populateRouteSelector() {
  const selType = d3.select("#select-route-type").property("value");
  let filtered = allRouteStats;
  if (selType !== "all") {
    filtered = allRouteStats.filter(d => d.route_type == +selType);
  }
  const select = d3.select("#select-route");
  // Limpiar antes de poblar
  select.selectAll("option").remove();
  // Agregar opción “Todas”
  select.append("option").attr("value", "all").text("Todas");
  // Luego, cada ruta filtrada
  filtered.forEach(d => {
    select.append("option")
      .attr("class", "route-option")
      .attr("value", d.route_id)
      .text(`${d.route_short_name} – ${d.route_long_name}`);
  });
}

function populateTop10RoutesTable() {
  const tbody = d3.select("#top10-routes-table tbody");
  tbody.selectAll("tr").remove();
  allTop10Routes.forEach((d, i) => {
    const row = tbody.append("tr")
      .on("mouseover", () => highlightRouteOnMap(d.route_id))
      .on("mouseout", () => clearRouteHighlight());
    row.append("td").text(i + 1);
    row.append("td").text(d.route_short_name);
    row.append("td").text(d.num_trips);
  });
}

function populateTop10StopsTable() {
  const tbody = d3.select("#top10-stops-table tbody");
  tbody.selectAll("tr").remove();
  allTop10Stops.forEach((d, i) => {
    const row = tbody.append("tr")
      .on("mouseover", () => highlightStopOnMap(d.stop_id))
      .on("mouseout", () => clearStopHighlight());
    row.append("td").text(i + 1);
    row.append("td").text(d.stop_id);
    row.append("td").text(d.usage_count);
  });
}

// ======================================
// DIBUJAR MAPA + HEATMAP + PARADAS + RUTAS
// ======================================
function drawMap() {
  // Limpiar SVG
  d3.select("#map-svg").selectAll("*").remove();

  const svg = d3.select("#map-svg");
  // Ahora clientWidth/clientHeight se adaptan al espacio disponible
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;

  if (width === 0 || height === 0) {
    // Si aún no se ha asignado un tamaño, salir sin dibujar
    return;
  }

  // Ajustamos viewBox para que el SVG sea escalable
  svg
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // Proyección GeoMercator centrada en SF, que ajuste automáticamente al nuevo tamaño
  const projection = d3.geoMercator().fitSize([width, height], sfBoundaryGeo);
  const path = d3.geoPath().projection(projection);

  // 1) Dibujar límites de SF
  svg.append("g")
    .selectAll("path")
    .data(sfBoundaryGeo.features)
    .enter().append("path")
      .attr("d", path)
      .attr("fill", "#ebedef")
      .attr("stroke", "#888")
      .attr("stroke-width", 1);

  // 2) Heatmap de densidad (solo si el checkbox está activo)
  const showHeatmap = d3.select("#toggle-heatmap").property("checked");
  if (showHeatmap) {
    const maxStops = d3.max(allStopDensity, d => +d.num_stops);
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, maxStops]);

    allStopDensity.forEach(d => {
      const lat0 = +d.lat_bin;
      const lon0 = +d.lon_bin;
      const lat1 = lat0 + 0.01;
      const lon1 = lon0 + 0.01;
      const corners = [
        [lon0, lat0],
        [lon1, lat0],
        [lon1, lat1],
        [lon0, lat1]
      ];
      const screenCoords = corners.map(coord => projection(coord));
      svg.append("polygon")
        .attr("points", screenCoords.map(p => p.join(",")).join(" "))
        .attr("fill", colorScale(+d.num_stops))
        .attr("stroke", "#ccc")
        .attr("stroke-width", 0.2)
        .attr("opacity", 0.6);
    });
  }

  // 3) Dibujar paradas (puntos de color gris oscuro #34495e)
  svg.append("g")
    .selectAll("circle.stop-dot")
    .data(allStopsList)
    .enter().append("circle")
      .attr("class", "stop-dot")
      .attr("cx", d => projection([+d.stop_lon, +d.stop_lat])[0])
      .attr("cy", d => projection([+d.stop_lon, +d.stop_lat])[1])
      .attr("r", 2)
      .attr("fill", "#34495e")
      .attr("opacity", 0.6);

  // Filtrado según selección actual
  const selType = d3.select("#select-route-type").property("value");
  const selRoute = d3.select("#select-route").property("value");

  // 4) Si hay ruta seleccionada, resaltar con su color de tipo y trazo grueso
  if (selRoute !== "all") {
    const ruta = allRouteShapes.find(r => r.route_id === selRoute);
    if (ruta) {
      const tipo = allRouteStats.find(x => x.route_id === selRoute).route_type;
      const color = typeColor[tipo] || "#000";

      ruta.coords.forEach(coord => {
        const [lon, lat] = coord;
        const [x, y] = projection([lon, lat]);
        svg.append("circle")
          .attr("cx", x)
          .attr("cy", y)
          .attr("r", 4)
          .attr("fill", color)
          .attr("stroke", "#fff")
          .attr("stroke-width", 0.8)
          .attr("opacity", 0.9);
      });
      if (ruta.coords.length > 1) {
        const lineGenerator = d3.line()
          .x(d => projection(d)[0])
          .y(d => projection(d)[1])
          .curve(d3.curveMonotoneX);
        svg.append("path")
          .datum(ruta.coords)
          .attr("d", lineGenerator)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 3)
          .attr("opacity", 0.8);
      }
    }
  }
  // 5) Si solo se filtró por tipo, resaltar todas las rutas de ese tipo con su color
  else if (selType !== "all") {
    const typeInt = +selType;
    const color = typeColor[typeInt] || "#000";

    const coordsToHighlight = [];
    allRouteShapes.forEach(r => {
      const tipoRuta = allRouteStats.find(x => x.route_id === r.route_id).route_type;
      if (tipoRuta === typeInt) {
        r.coords.forEach(coord => coordsToHighlight.push(coord));
      }
    });
    coordsToHighlight.forEach(([lon, lat]) => {
      const [x, y] = projection([lon, lat]);
      svg.append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", 3)
        .attr("fill", color)
        .attr("opacity", 0.8);
    });
  }
}

// ======================================
// RESALTADO ON MOUSEOVER (Rutas y Paradas)
// ======================================
function highlightRouteOnMap(route_id) {
  const svg = d3.select("#map-svg");
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  if (width === 0 || height === 0) return;

  const projection = d3.geoMercator().fitSize([width, height], sfBoundaryGeo);
  const ruta = allRouteShapes.find(r => r.route_id === route_id);
  if (ruta && ruta.coords.length > 1) {
    const tipo = allRouteStats.find(x => x.route_id === route_id).route_type;
    const color = typeColor[tipo] || "#FF4136";

    const lineGenerator = d3.line()
      .x(d => projection(d)[0])
      .y(d => projection(d)[1])
      .curve(d3.curveMonotoneX);
    svg.append("path")
      .datum(ruta.coords)
      .attr("class", "highlight-route")
      .attr("d", lineGenerator)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 4)
      .attr("opacity", 0.9);
  }
}

function clearRouteHighlight() {
  d3.selectAll(".highlight-route").remove();
}

function highlightStopOnMap(stop_id) {
  const svg = d3.select("#map-svg");
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  if (width === 0 || height === 0) return;

  const projection = d3.geoMercator().fitSize([width, height], sfBoundaryGeo);
  const stop = allStopsList.find(s => s.stop_id === stop_id);
  if (stop) {
    const [x, y] = projection([+stop.stop_lon, +stop.stop_lat]);
    svg.append("circle")
      .attr("class", "highlight-stop")
      .attr("cx", x)
      .attr("cy", y)
      .attr("r", 6)
      .attr("fill", "#2ECC40")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.2)
      .attr("opacity", 0.9);
  }
}

function clearStopHighlight() {
  d3.selectAll(".highlight-stop").remove();
}

// ======================================
// DIBUJAR SCATTERPLOT (HIPÓTESIS 1) 
// ======================================
function drawScatterplot() {
  const svg = d3.select("#chart-scatter");
  svg.selectAll("*").remove();

  const width = svg.node().clientWidth - margin.left - margin.right;
  const height = svg.node().clientHeight - margin.top - margin.bottom;
  if (width <= 0 || height <= 0) return; // Evitar errores si no hay espacio

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Filtrar datos según controles
  const selType = d3.select("#select-route-type").property("value");
  const selRoute = d3.select("#select-route").property("value");
  let data = allRouteStats.slice();
  if (selType !== "all") {
    data = data.filter(d => d.route_type == +selType);
  }
  if (selRoute !== "all") {
    data = data.filter(d => d.route_id === selRoute);
  }

  // Ejes X e Y
  const x = d3.scaleLinear()
    .domain(d3.extent(data, d => +d.num_stops))
    .nice()
    .range([0, width]);
  const y = d3.scaleLinear()
    .domain(d3.extent(data, d => +d.num_trips))
    .nice()
    .range([height, 0]);

  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(6));
  g.append("g")
    .call(d3.axisLeft(y).ticks(6));

  // Etiqueta de título breve para ayudar a entender
  svg.append("text")
    .attr("x", margin.left + width / 2)
    .attr("y", margin.top - 10)
    .attr("text-anchor", "middle")
    .attr("font-size", "0.95rem")
    .attr("fill", "#555");

  // Dibujar puntos con color por tipo
  g.selectAll("circle")
    .data(data)
    .enter().append("circle")
      .attr("cx", d => x(+d.num_stops))
      .attr("cy", d => y(+d.num_trips))
      .attr("r", 5)
      .attr("fill", d => typeColor[d.route_type] || "#888")
      .attr("opacity", 0.8)
      .on("mouseover", (event, d) => {
        tooltip.transition().duration(200).style("opacity", 0.9);
        tooltip.html(`
          <strong>${d.route_short_name} – ${d.route_long_name}</strong><br/>
          Tipo: ${d.route_type === 0 ? "Tranvía" : d.route_type === 3 ? "Bus" : "Cable Car"}<br/>
          Paradas: ${d.num_stops}<br/>
          Viajes: ${d.num_trips}
        `)
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
      })
      .on("mouseout", () => {
        tooltip.transition().duration(200).style("opacity", 0);
      });

  // Etiquetas de ejes
  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 40)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .attr("font-weight", 500)
    .text("Número de Paradas");

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", - (height / 2))
    .attr("y", -45)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .attr("font-weight", 500)
    .text("Número de Viajes");
}

// ======================================
// DIBUJAR LÍNEA (HIPÓTESIS 2)
// ======================================
function drawLineChart() {
  const svg = d3.select("#chart-line");
  svg.selectAll("*").remove();

  const width = svg.node().clientWidth - margin.left - margin.right;
  const height = svg.node().clientHeight - margin.top - margin.bottom;
  if (width <= 0 || height <= 0) return; // Evitar errores si no hay espacio

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Usamos datos de allHourly (hourly_weekday.json)
  let data = allHourly.slice();

  // Ejes X e Y
  const x = d3.scaleLinear().domain([0, 23]).range([0, width]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => +d.num_arrivals)])
    .nice()
    .range([height, 0]);

  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(12).tickFormat(d => `${d}:00`));
  g.append("g")
    .call(d3.axisLeft(y).ticks(6));

  // Línea suave con curva monotoneX
  const line = d3.line()
    .x(d => x(+d.hour))
    .y(d => y(+d.num_arrivals))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#FF851B")
    .attr("stroke-width", 3)
    .attr("d", line)
    .attr("opacity", 0.8);

  // Puntos grandes de color naranja
  g.selectAll("circle")
    .data(data)
    .enter().append("circle")
      .attr("cx", d => x(+d.hour))
      .attr("cy", d => y(+d.num_arrivals))
      .attr("r", 4)
      .attr("fill", "#FF851B")
      .on("mouseover", (event, d) => {
        tooltip.transition().duration(200).style("opacity", 0.9);
        tooltip.html(`
          <strong>${d.hour}:00</strong><br/>
          ${d.num_arrivals} llegadas
        `)
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
      })
      .on("mouseout", () => {
        tooltip.transition().duration(200).style("opacity", 0);
      });

  // Etiquetas de ejes
  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 40)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .attr("font-weight", 500)
    .text("Hora del Día");

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", - (height / 2))
    .attr("y", -45)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .attr("font-weight", 500)
    .text("Llegadas");
}
