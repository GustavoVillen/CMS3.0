// Estimación OFFLINE de la ciudad/puerto más próximo a una posición geográfica.
//
// No hace llamadas externas (respeta la política anti-SSRF del proyecto): usa un
// dataset local de ciudades y puertos + distancia haversine. Es una ESTIMACIÓN;
// por eso el consumidor debe mostrar también la distancia (una posición en alta
// mar puede quedar a cientos de km de la costa más cercana del dataset).
//
// El dataset está sesgado a la región de operación (Río de la Plata / Paraná /
// Sudamérica) y complementado con capitales y grandes puertos del mundo.

interface City {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

// lat: N+ / S-   ·   lon: E+ / W-
const CITIES: City[] = [
  // ── Argentina — Río de la Plata / Paraná / costa ──
  { name: "Buenos Aires", country: "Argentina", lat: -34.6037, lon: -58.3816 },
  { name: "La Plata", country: "Argentina", lat: -34.9215, lon: -57.9545 },
  { name: "Ensenada", country: "Argentina", lat: -34.8600, lon: -57.9100 },
  { name: "Campana", country: "Argentina", lat: -34.1636, lon: -58.9592 },
  { name: "Zárate", country: "Argentina", lat: -34.0975, lon: -59.0290 },
  { name: "San Nicolás de los Arroyos", country: "Argentina", lat: -33.3339, lon: -60.2130 },
  { name: "Villa Constitución", country: "Argentina", lat: -33.2286, lon: -60.3336 },
  { name: "San Lorenzo", country: "Argentina", lat: -32.7500, lon: -60.7333 },
  { name: "Rosario", country: "Argentina", lat: -32.9468, lon: -60.6393 },
  { name: "Diamante", country: "Argentina", lat: -32.0667, lon: -60.6500 },
  { name: "Santa Fe", country: "Argentina", lat: -31.6333, lon: -60.7000 },
  { name: "Paraná", country: "Argentina", lat: -31.7333, lon: -60.5238 },
  { name: "Gualeguaychú", country: "Argentina", lat: -33.0094, lon: -58.5172 },
  { name: "Concepción del Uruguay", country: "Argentina", lat: -32.4833, lon: -58.2333 },
  { name: "Ibicuy", country: "Argentina", lat: -33.7400, lon: -59.1700 },
  { name: "Corrientes", country: "Argentina", lat: -27.4692, lon: -58.8306 },
  { name: "Barranqueras", country: "Argentina", lat: -27.4833, lon: -58.9333 },
  { name: "Posadas", country: "Argentina", lat: -27.3671, lon: -55.8961 },
  { name: "Mar del Plata", country: "Argentina", lat: -38.0055, lon: -57.5426 },
  { name: "Quequén / Necochea", country: "Argentina", lat: -38.5545, lon: -58.7396 },
  { name: "Bahía Blanca", country: "Argentina", lat: -38.7183, lon: -62.2661 },
  { name: "Puerto Madryn", country: "Argentina", lat: -42.7692, lon: -65.0385 },
  { name: "Comodoro Rivadavia", country: "Argentina", lat: -45.8641, lon: -67.4966 },
  { name: "Río Gallegos", country: "Argentina", lat: -51.6230, lon: -69.2168 },
  { name: "Ushuaia", country: "Argentina", lat: -54.8019, lon: -68.3030 },
  // ── Hidrovía Paraná-Paraguay (densificado — ruta de operación del buque) ──
  // Río Paraná (aguas abajo → arriba), Argentina
  { name: "Ramallo", country: "Argentina", lat: -33.4833, lon: -60.0072 },
  { name: "San Pedro", country: "Argentina", lat: -33.6795, lon: -59.6633 },
  { name: "Baradero", country: "Argentina", lat: -33.8081, lon: -59.5069 },
  { name: "Puerto General San Martín", country: "Argentina", lat: -32.7167, lon: -60.7333 },
  { name: "Timbúes", country: "Argentina", lat: -32.6667, lon: -60.7000 },
  { name: "Victoria", country: "Argentina", lat: -32.6167, lon: -60.1667 },
  { name: "La Paz", country: "Argentina", lat: -30.7486, lon: -59.6467 },
  { name: "Esquina", country: "Argentina", lat: -30.0167, lon: -59.5333 },
  { name: "Goya", country: "Argentina", lat: -29.1400, lon: -59.2626 },
  { name: "Reconquista", country: "Argentina", lat: -29.1489, lon: -59.6431 },
  { name: "Bella Vista", country: "Argentina", lat: -28.5089, lon: -59.0378 },
  { name: "Empedrado", country: "Argentina", lat: -27.9553, lon: -58.8072 },
  { name: "Itatí", country: "Argentina", lat: -27.2667, lon: -58.2436 },
  { name: "Ituzaingó", country: "Argentina", lat: -27.5892, lon: -56.6892 },
  // Río Paraguay (confluencia → aguas arriba)
  { name: "Formosa", country: "Argentina", lat: -26.1849, lon: -58.1731 },
  { name: "Clorinda", country: "Argentina", lat: -25.2853, lon: -57.7192 },
  { name: "Pilar", country: "Paraguay", lat: -26.8598, lon: -58.2986 },
  { name: "Villa Hayes", country: "Paraguay", lat: -25.0919, lon: -57.5342 },
  { name: "Concepción", country: "Paraguay", lat: -23.4064, lon: -57.4344 },
  { name: "Fuerte Olimpo", country: "Paraguay", lat: -21.0411, lon: -57.8739 },
  { name: "Bahía Negra", country: "Paraguay", lat: -20.2236, lon: -58.1728 },
  { name: "Porto Murtinho", country: "Brasil", lat: -21.6989, lon: -57.8825 },
  { name: "Corumbá", country: "Brasil", lat: -19.0092, lon: -57.6533 },
  { name: "Ladário", country: "Brasil", lat: -19.0044, lon: -57.6017 },
  { name: "Cáceres", country: "Brasil", lat: -16.0764, lon: -57.6818 },
  // Alto Paraná (Posadas → Iguazú)
  { name: "Encarnación", country: "Paraguay", lat: -27.3306, lon: -55.8656 },
  { name: "Ciudad del Este", country: "Paraguay", lat: -25.5097, lon: -54.6111 },
  { name: "Puerto Iguazú", country: "Argentina", lat: -25.5972, lon: -54.5786 },
  // ── Uruguay ──
  { name: "Montevideo", country: "Uruguay", lat: -34.9011, lon: -56.1645 },
  { name: "Colonia del Sacramento", country: "Uruguay", lat: -34.4726, lon: -57.8444 },
  { name: "Nueva Palmira", country: "Uruguay", lat: -33.8794, lon: -58.4111 },
  { name: "Fray Bentos", country: "Uruguay", lat: -33.1167, lon: -58.3000 },
  { name: "Paysandú", country: "Uruguay", lat: -32.3214, lon: -58.0756 },
  { name: "Punta del Este", country: "Uruguay", lat: -34.9667, lon: -54.9500 },
  // ── Paraguay ──
  { name: "Asunción", country: "Paraguay", lat: -25.2637, lon: -57.5759 },
  { name: "Villeta", country: "Paraguay", lat: -25.5100, lon: -57.5500 },
  // ── Brasil ──
  { name: "Rio Grande", country: "Brasil", lat: -32.0350, lon: -52.0986 },
  { name: "Porto Alegre", country: "Brasil", lat: -30.0346, lon: -51.2177 },
  { name: "Itajaí", country: "Brasil", lat: -26.9078, lon: -48.6619 },
  { name: "Paranaguá", country: "Brasil", lat: -25.5161, lon: -48.5222 },
  { name: "Santos", country: "Brasil", lat: -23.9608, lon: -46.3336 },
  { name: "São Paulo", country: "Brasil", lat: -23.5505, lon: -46.6333 },
  { name: "Rio de Janeiro", country: "Brasil", lat: -22.9068, lon: -43.1729 },
  { name: "Vitória", country: "Brasil", lat: -20.3155, lon: -40.3128 },
  { name: "Salvador", country: "Brasil", lat: -12.9777, lon: -38.5016 },
  { name: "Recife", country: "Brasil", lat: -8.0476, lon: -34.8770 },
  { name: "Fortaleza", country: "Brasil", lat: -3.7319, lon: -38.5267 },
  { name: "Belém", country: "Brasil", lat: -1.4558, lon: -48.5039 },
  { name: "Manaus", country: "Brasil", lat: -3.1190, lon: -60.0217 },
  // ── Chile ──
  { name: "Punta Arenas", country: "Chile", lat: -53.1638, lon: -70.9171 },
  { name: "Talcahuano", country: "Chile", lat: -36.7249, lon: -73.1168 },
  { name: "San Antonio", country: "Chile", lat: -33.5928, lon: -71.6056 },
  { name: "Valparaíso", country: "Chile", lat: -33.0472, lon: -71.6127 },
  { name: "Santiago", country: "Chile", lat: -33.4489, lon: -70.6693 },
  { name: "Antofagasta", country: "Chile", lat: -23.6509, lon: -70.3975 },
  { name: "Iquique", country: "Chile", lat: -20.2307, lon: -70.1355 },
  // ── Resto de Sudamérica ──
  { name: "Callao / Lima", country: "Perú", lat: -12.0464, lon: -77.0428 },
  { name: "Guayaquil", country: "Ecuador", lat: -2.1962, lon: -79.8862 },
  { name: "Bogotá", country: "Colombia", lat: 4.7110, lon: -74.0721 },
  { name: "Cartagena", country: "Colombia", lat: 10.3910, lon: -75.4794 },
  { name: "La Guaira / Caracas", country: "Venezuela", lat: 10.6031, lon: -66.9146 },
  // ── Norteamérica / Centroamérica ──
  { name: "Ciudad de Panamá", country: "Panamá", lat: 8.9824, lon: -79.5199 },
  { name: "Colón", country: "Panamá", lat: 9.3592, lon: -79.9014 },
  { name: "Veracruz", country: "México", lat: 19.1738, lon: -96.1342 },
  { name: "Houston", country: "EE. UU.", lat: 29.7604, lon: -95.3698 },
  { name: "Nueva Orleans", country: "EE. UU.", lat: 29.9511, lon: -90.0715 },
  { name: "Miami", country: "EE. UU.", lat: 25.7617, lon: -80.1918 },
  { name: "Savannah", country: "EE. UU.", lat: 32.0809, lon: -81.0912 },
  { name: "Norfolk", country: "EE. UU.", lat: 36.8508, lon: -76.2859 },
  { name: "Nueva York", country: "EE. UU.", lat: 40.7128, lon: -74.0060 },
  { name: "Los Ángeles / Long Beach", country: "EE. UU.", lat: 33.7701, lon: -118.1937 },
  { name: "Seattle", country: "EE. UU.", lat: 47.6062, lon: -122.3321 },
  { name: "Vancouver", country: "Canadá", lat: 49.2827, lon: -123.1207 },
  { name: "Montreal", country: "Canadá", lat: 45.5017, lon: -73.5673 },
  // ── Europa ──
  { name: "Lisboa", country: "Portugal", lat: 38.7223, lon: -9.1393 },
  { name: "Algeciras", country: "España", lat: 36.1408, lon: -5.4562 },
  { name: "Valencia", country: "España", lat: 39.4699, lon: -0.3763 },
  { name: "Barcelona", country: "España", lat: 41.3851, lon: 2.1734 },
  { name: "Marsella", country: "Francia", lat: 43.2965, lon: 5.3698 },
  { name: "Le Havre", country: "Francia", lat: 49.4944, lon: 0.1079 },
  { name: "Londres", country: "Reino Unido", lat: 51.5074, lon: -0.1278 },
  { name: "Róterdam", country: "Países Bajos", lat: 51.9244, lon: 4.4777 },
  { name: "Amberes", country: "Bélgica", lat: 51.2194, lon: 4.4025 },
  { name: "Hamburgo", country: "Alemania", lat: 53.5511, lon: 9.9937 },
  { name: "Bremerhaven", country: "Alemania", lat: 53.5396, lon: 8.5809 },
  { name: "Génova", country: "Italia", lat: 44.4056, lon: 8.9463 },
  { name: "El Pireo / Atenas", country: "Grecia", lat: 37.9838, lon: 23.7275 },
  { name: "Estambul", country: "Turquía", lat: 41.0082, lon: 28.9784 },
  { name: "Gdansk", country: "Polonia", lat: 54.3520, lon: 18.6466 },
  { name: "San Petersburgo", country: "Rusia", lat: 59.9311, lon: 30.3609 },
  // ── África ──
  { name: "Casablanca", country: "Marruecos", lat: 33.5731, lon: -7.5898 },
  { name: "Dakar", country: "Senegal", lat: 14.7167, lon: -17.4677 },
  { name: "Lagos", country: "Nigeria", lat: 6.5244, lon: 3.3792 },
  { name: "Ciudad del Cabo", country: "Sudáfrica", lat: -33.9249, lon: 18.4241 },
  { name: "Durban", country: "Sudáfrica", lat: -29.8587, lon: 31.0218 },
  { name: "Alejandría", country: "Egipto", lat: 31.2001, lon: 29.9187 },
  { name: "Mombasa", country: "Kenia", lat: -4.0435, lon: 39.6682 },
  // ── Medio Oriente / Asia ──
  { name: "Jebel Ali / Dubái", country: "EAU", lat: 25.2048, lon: 55.2708 },
  { name: "Yeda", country: "Arabia Saudita", lat: 21.4858, lon: 39.1925 },
  { name: "Bombay", country: "India", lat: 19.0760, lon: 72.8777 },
  { name: "Colombo", country: "Sri Lanka", lat: 6.9271, lon: 79.8612 },
  { name: "Singapur", country: "Singapur", lat: 1.3521, lon: 103.8198 },
  { name: "Port Klang", country: "Malasia", lat: 3.0000, lon: 101.4000 },
  { name: "Bangkok", country: "Tailandia", lat: 13.7563, lon: 100.5018 },
  { name: "Yakarta", country: "Indonesia", lat: -6.2088, lon: 106.8456 },
  { name: "Manila", country: "Filipinas", lat: 14.5995, lon: 120.9842 },
  { name: "Hong Kong", country: "China", lat: 22.3193, lon: 114.1694 },
  { name: "Shenzhen", country: "China", lat: 22.5431, lon: 114.0579 },
  { name: "Ningbo", country: "China", lat: 29.8683, lon: 121.5440 },
  { name: "Shanghái", country: "China", lat: 31.2304, lon: 121.4737 },
  { name: "Busán", country: "Corea del Sur", lat: 35.1796, lon: 129.0756 },
  { name: "Kaohsiung", country: "Taiwán", lat: 22.6273, lon: 120.3014 },
  { name: "Yokohama / Tokio", country: "Japón", lat: 35.4437, lon: 139.6380 },
  // ── Oceanía ──
  { name: "Sídney", country: "Australia", lat: -33.8688, lon: 151.2093 },
  { name: "Melbourne", country: "Australia", lat: -37.8136, lon: 144.9631 },
  { name: "Auckland", country: "Nueva Zelanda", lat: -36.8485, lon: 174.7633 },
];

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NearestCityResult {
  name: string;
  country: string;
  distanceKm: number;
}

/**
 * Devuelve la ciudad/puerto del dataset más cercano a (lat, lon), o null si las
 * coordenadas no son válidas. La distancia permite al consumidor comunicar la
 * incertidumbre (p. ej. posiciones en alta mar).
 */
export function nearestCity(lat: number | null | undefined, lon: number | null | undefined): NearestCityResult | null {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null; // posición nula/no seteada

  let best: City | null = null;
  let bestKm = Infinity;
  for (const c of CITIES) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (km < bestKm) { bestKm = km; best = c; }
  }
  if (!best) return null;
  return { name: best.name, country: best.country, distanceKm: bestKm };
}
