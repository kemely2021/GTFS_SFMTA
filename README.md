# Dashboard SFMTA: Análisis del Sistema de Transporte Público de San Francisco

Este proyecto es un **Dashboard interactivo** que permite explorar datos estáticos GTFS del sistema de transporte público de San Francisco (SFMTA) mediante visualizaciones D3. Incluye:

- **Mapa de Calor de Densidad de Paradas**: utiliza la capa GeoJSON de San Francisco para mostrar, sobre un fondo de polígonos, la concentración espacial de paradas de autobús, tranvía y cable car.
- **Scatterplot Interactivo (Hipótesis 1)**: grafica el número de paradas vs. el número de viajes diarios de cada ruta, coloreando cada punto según el tipo de transporte (Tranvía, Bus, Cable Car). Permite filtrar por tipo y seleccionar puntos mediante brushing.
- **Gráfico de Línea Interactivo (Hipótesis 2)**: muestra la cantidad de llegadas de vehículos por hora en días laborables, con una regla vertical que sigue el cursor y tooltips para cada punto.

El propósito es realizar un Análisis Exploratorio de Datos (EDA) que responda a las siguientes preguntas:

1. ¿Cómo se relaciona la longitud de una ruta (número de paradas) con la frecuencia de viajes diarios?  
2. ¿En qué franjas horarias se concentran más llegadas de vehículos en días laborables?  
3. ¿Cuál es la distribución geográfica de la densidad de paradas en la ciudad, y dónde se ubican las concentraciones más altas?


