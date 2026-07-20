// Weather store — fetches current conditions + sunrise/sunset from Open-Meteo (free, no API key).
// The user optionally provides a zip code in settings; we geocode it once, then poll weather
// every 15 minutes. Results drive the DynamicBackground's ambient effects (rain, snow, storms, fog).

import { create } from 'zustand';

export interface WeatherState {
  // Resolved coordinates
  latitude: number | null;
  longitude: number | null;
  locationLabel: string; // "New York, NY" etc.

  // Current conditions (WMO weather codes: https://open-meteo.com/en/docs)
  weatherCode: number | null;    // 0=clear, 1-3=cloudy, 45/48=fog, 51-67=rain/drizzle, 71-77=snow, 80-82=showers, 95-99=thunderstorm
  temperature: number | null;    // °F
  isDay: boolean;

  // Actual sunrise/sunset for today (ISO strings)
  sunrise: string | null;
  sunset: string | null;

  // Status
  lastFetched: number | null;
  error: string | null;
  loading: boolean;
}

interface WeatherActions {
  /** Geocode a zip code (US) or city name, then fetch weather. */
  fetchByZip: (zipOrCity: string) => Promise<void>;
  /** Fetch weather for already-resolved coordinates. */
  fetchWeather: () => Promise<void>;
  /** Clear weather data (user disabled it). */
  clear: () => void;
}

// WMO weather code → human-readable category for the background
export type WeatherCondition = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm';
export function weatherCondition(code: number | null): WeatherCondition {
  if (code === null) return 'clear';
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain';
  return 'thunderstorm';
}

export function weatherSeverity(code: number | null): number {
  if (code === null) return 0;
  // Clouds: 1=partly (0.3), 2=mostly (0.6), 3=overcast (1.0)
  if (code >= 1 && code <= 3) return code / 3.0;
  // Fog: 45=fog (0.5), 48=depositing rime fog (1.0)
  if (code === 45) return 0.5;
  if (code === 48) return 1.0;
  // Rain/Drizzle: x1=light (0.3), x3=moderate (0.6), x5/x7=heavy (1.0)
  if ([51, 61, 71, 80].includes(code)) return 0.3;
  if ([53, 63, 73, 81].includes(code)) return 0.6;
  if ([55, 57, 65, 67, 75, 77, 82].includes(code)) return 1.0;
  // Thunderstorm: 95=slight (0.5), 96/99=heavy (1.0)
  if (code === 95) return 0.5;
  if (code > 95) return 1.0;
  return 0.5; // fallback
}

const INITIAL: WeatherState = {
  latitude: null,
  longitude: null,
  locationLabel: '',
  weatherCode: null,
  temperature: null,
  isDay: true,
  sunrise: null,
  sunset: null,
  lastFetched: null,
  error: null,
  loading: false,
};

export const useWeatherStore = create<WeatherState & WeatherActions>((set, get) => ({
  ...INITIAL,

  fetchByZip: async (zipOrCity: string) => {
    set({ loading: true, error: null });
    try {
      // Open-Meteo geocoding — works with city names and postal codes
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(zipOrCity)}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      const geoData = await geoRes.json();

      if (!geoData.results?.length) {
        set({ loading: false, error: `Could not find location: "${zipOrCity}"` });
        return;
      }

      const loc = geoData.results[0];
      set({
        latitude: loc.latitude,
        longitude: loc.longitude,
        locationLabel: [loc.name, loc.admin1, loc.country_code].filter(Boolean).join(', '),
      });

      await get().fetchWeather();
    } catch (err) {
      set({ loading: false, error: `Geocoding failed: ${err}` });
    }
  },

  fetchWeather: async () => {
    const { latitude, longitude } = get();
    if (latitude === null || longitude === null) return;

    set({ loading: true, error: null });
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
      const res = await fetch(url);
      const data = await res.json();

      set({
        weatherCode: data.current?.weather_code ?? null,
        temperature: data.current?.temperature_2m ?? null,
        isDay: data.current?.is_day === 1,
        sunrise: data.daily?.sunrise?.[0] ?? null,
        sunset: data.daily?.sunset?.[0] ?? null,
        lastFetched: Date.now(),
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: `Weather fetch failed: ${err}` });
    }
  },

  clear: () => set(INITIAL),
}));

// Auto-refresh every 15 minutes if we have coordinates
let _weatherInterval: ReturnType<typeof setInterval> | null = null;
export function startWeatherPolling() {
  if (_weatherInterval) clearInterval(_weatherInterval);
  _weatherInterval = setInterval(() => {
    const { latitude } = useWeatherStore.getState();
    if (latitude !== null) useWeatherStore.getState().fetchWeather();
  }, 15 * 60 * 1000);
}
