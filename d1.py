import zipfile
import os
import pandas as pd
import numpy as np

# ==============================================
# 0. Configuración de rutas y carpeta de salida
# ==============================================
ZIP_PATH = 'muni_gtfs-current.zip'
OUTPUT_DIR = 'data'
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ==============================================
# 1. CARGA DE ARCHIVOS GTFS
# ==============================================
with zipfile.ZipFile(ZIP_PATH, 'r') as z:
    # 1.1 Leer rutas
    routes = pd.read_csv(
        z.open('routes.txt'),
        dtype=str,
        usecols=['route_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color']
    )
    # 1.2 Leer paradas
    stops = pd.read_csv(
        z.open('stops.txt'),
        dtype=str,
        usecols=['stop_id', 'stop_name', 'stop_lat', 'stop_lon']
    )
    # 1.3 Leer viajes
    trips = pd.read_csv(
        z.open('trips.txt'),
        dtype=str,
        usecols=['trip_id', 'route_id', 'service_id']
    )
    # 1.4 Leer tiempos de parada (incluye stop_sequence para ordenar)
    stop_times = pd.read_csv(
        z.open('stop_times.txt'),
        dtype=str,
        usecols=['trip_id', 'arrival_time', 'stop_id', 'stop_sequence']
    )
    # 1.5 Leer calendario
    calendar = pd.read_csv(
        z.open('calendar.txt'),
        dtype=str
    )

# ==============================================
# 2. FILTROS / LIMPIEZA BÁSICA
# ==============================================
# 2.1 Filtrar paradas dentro del área aproximada de San Francisco
stops['stop_lat'] = stops['stop_lat'].astype(float)
stops['stop_lon'] = stops['stop_lon'].astype(float)
stops = stops[
    stops['stop_lat'].between(37.70, 37.83) &
    stops['stop_lon'].between(-122.52, -122.36)
].reset_index(drop=True)

# 2.2 Convertir route_type a entero
routes['route_type'] = routes['route_type'].astype(int)

# 2.3 Eliminar trips sin route_id válido
trips = trips.dropna(subset=['route_id'])
trips = trips[trips['route_id'].isin(routes['route_id'])].reset_index(drop=True)

# ==============================================
# 3. CONVERTIR arrival_time A SEGUNDOS E INSERTAR HORA
# ==============================================
def time_to_seconds(t):
    try:
        h, m, s = map(int, t.split(':'))
        return h * 3600 + m * 60 + s
    except:
        return np.nan

stop_times['seconds'] = stop_times['arrival_time'].apply(time_to_seconds)
stop_times = stop_times.dropna(subset=['seconds'])
stop_times['seconds'] = stop_times['seconds'].astype(int)
stop_times['hour'] = (stop_times['seconds'] // 3600) % 24

# 3.1 Filtrar stop_times para quedarse solo con trips válidos
stop_times = stop_times[stop_times['trip_id'].isin(trips['trip_id'])].reset_index(drop=True)

# 3.2 Merge para que stop_times incluya route_id (necesario para shapes)
stop_times = stop_times.merge(
    trips[['trip_id', 'route_id']],
    on='trip_id',
    how='left'
)

# ==============================================
# 4. GENERAR route_stats.json  (HIPÓTESIS 1)
# ==============================================
# 4.1 Contar número de viajes únicos por cada route_id
df_route_trips = (
    trips
    .groupby('route_id')
    .agg(num_trips=('trip_id', 'nunique'))
    .reset_index()
)

# 4.2 Contar número de paradas únicas por route_id (usando stop_times)
df_route_stops = (
    stop_times
    .groupby('route_id')
    .agg(num_stops=('stop_id', 'nunique'))
    .reset_index()
)

# 4.3 Unir con metadatos de routes
df_route_stats = (
    df_route_trips
    .merge(df_route_stops, on='route_id', how='left')
    .merge(routes, on='route_id', how='left')
)

# 4.4 Exportar a JSON en formato “orient=records”
route_stats_export = df_route_stats[[
    'route_id',
    'route_short_name',
    'route_long_name',
    'route_type',
    'num_stops',
    'num_trips'
]]
route_stats_export.to_json(
    os.path.join(OUTPUT_DIR, 'route_stats.json'),
    orient='records',
    force_ascii=False
)

# ==============================================
# 5. GENERAR top10_routes.json
# ==============================================
top10_routes = df_route_stats.sort_values('num_trips', ascending=False).head(10)[[
    'route_id', 'route_short_name', 'route_long_name', 'num_trips'
]]
top10_routes.to_json(
    os.path.join(OUTPUT_DIR, 'top10_routes.json'),
    orient='records',
    force_ascii=False
)

# ==============================================
# 6. GENERAR hourly_weekday.json (HIPÓTESIS 2)
# ==============================================
# 6.1 Convertir columnas monday...sunday a int
calendar[['monday','tuesday','wednesday','thursday','friday','saturday','sunday']] = \
    calendar[['monday','tuesday','wednesday','thursday','friday','saturday','sunday']].astype(int)

# 6.2 Filtrar services que funcionan los días de semana (monday == 1)
weekday_services = calendar[calendar['monday'] == 1]['service_id'].tolist()

# 6.3 Filtrar trips y stop_times que correspondan a esos service_id
trips_weekday = trips[trips['service_id'].isin(weekday_services)]
stop_times_weekday = stop_times[stop_times['trip_id'].isin(trips_weekday['trip_id'])]

# 6.4 Agrupar llegadas por hora
df_hourly_service = (
    stop_times_weekday
    .groupby('hour')
    .agg(num_arrivals=('trip_id', 'count'))
    .reset_index()
)

# 6.5 Exportar a JSON
df_hourly_service.to_json(
    os.path.join(OUTPUT_DIR, 'hourly_weekday.json'),
    orient='records'
)

# ==============================================
# 7. GENERAR stop_density.json  (HIPÓtesis 3)
# ==============================================
# 7.1 Crear columnas lat_bin y lon_bin (agrupación 0.01° × 0.01°)
stops['lat_bin'] = (stops['stop_lat'] // 0.01) * 0.01
stops['lon_bin'] = (stops['stop_lon'] // 0.01) * 0.01

df_stop_density = (
    stops
    .groupby(['lat_bin','lon_bin'])
    .agg(num_stops=('stop_id', 'nunique'))
    .reset_index()
)

# 7.2 Exportar a JSON
df_stop_density.to_json(
    os.path.join(OUTPUT_DIR, 'stop_density.json'),
    orient='records'
)

# ==============================================
# 8. GENERAR stops_list.json Y top10_stops.json
# ==============================================
# 8.1 Contar cuántas veces aparece cada stop_id en stop_times (indicador de uso)
stop_usage = (
    stop_times
    .groupby('stop_id')
    .agg(usage_count=('stop_id', 'count'))
    .reset_index()
)

# 8.2 Unir con stops para tener stop_name, lat, lon
stops_list = stops.merge(
    stop_usage,
    on='stop_id',
    how='left'
)
stops_list['usage_count'] = stops_list['usage_count'].fillna(0).astype(int)

# 8.3 Preparar lista completa
stops_list_export = stops_list[[
    'stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'usage_count'
]]
stops_list_export.to_json(
    os.path.join(OUTPUT_DIR, 'stops_list.json'),
    orient='records',
    force_ascii=False
)

# 8.4 Top 10 stops más usadas
top10_stops = stops_list_export.sort_values(
    'usage_count',
    ascending=False
).head(10)
top10_stops.to_json(
    os.path.join(OUTPUT_DIR, 'top10_stops.json'),
    orient='records',
    force_ascii=False
)

# ==============================================
# 9. GENERAR route_shapes.json  (geometría de rutas)
# ==============================================
# Para cada route_id, usamos el “primer trip” y extraemos la secuencia ordenada de sus stop_id,
# para luego convertir cada stop_id en [lon, lat] y así tener la línea de la ruta.

# 9.1 Seleccionar un trip representativo por cada route_id (el de menor trip_id para simplicidad)
rep_trips = (
    trips
    .groupby('route_id')
    .agg(sample_trip=('trip_id', 'min'))
    .reset_index()
)

route_shapes = []
for _, row in rep_trips.iterrows():
    rid = row['route_id']
    sample_trip_id = row['sample_trip']
    # 9.2 Filtrar stop_times de ese trip y ordenar por stop_sequence
    seq = stop_times[stop_times['trip_id'] == sample_trip_id][['stop_sequence', 'stop_id']]
    seq = seq.dropna(subset=['stop_sequence']).copy()
    seq['stop_sequence'] = seq['stop_sequence'].astype(int)
    seq = seq.sort_values('stop_sequence')
    # 9.3 Convertir cada stop_id en coordenadas [lon, lat]
    coords = []
    for sid in seq['stop_id'].tolist():
        srow = stops[stops['stop_id'] == sid]
        if not srow.empty:
            lat = float(srow.iloc[0]['stop_lat'])
            lon = float(srow.iloc[0]['stop_lon'])
            coords.append([lon, lat])
    route_shapes.append({
        "route_id": rid,
        "coords": coords
    })

# 9.4 Exportar a JSON
pd.DataFrame(route_shapes).to_json(
    os.path.join(OUTPUT_DIR, 'route_shapes.json'),
    orient='records',
    force_ascii=False
)

# ==============================================
# 10. Mensaje final de confirmación
# ==============================================
print("Se generaron los siguientes archivos JSON en", OUTPUT_DIR)
print(" • route_stats.json")
print(" • top10_routes.json")
print(" • hourly_weekday.json")
print(" • stop_density.json")
print(" • stops_list.json")
print(" • top10_stops.json")
print(" • route_shapes.json")
