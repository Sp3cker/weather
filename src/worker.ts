/// <reference types="@cloudflare/workers-types" />

interface Env {
  API_URL: string;
  WEATHER_CACHE: KVNamespace;
}

interface WeatherAPIResponse {
  current_weather?: {
    temperature: number;
    time: string;
  };
  hourly?: {
    time: string[];
    precipitation: number[];
    cloudcover: number[];
  };
}

interface CachedWeatherData {
  temperature: number;
  precipitation: number;
  cloudcover: number;
  timestamp: string;
  lastUpdated: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const CACHE_KEY = "weather_fukuoka";
const CACHE_TTL = 4 * 60 * 60; // 4 hours in seconds

async function fetchWeatherData(env: Env): Promise<CachedWeatherData | null> {
  const apiUrl =
    `${env.API_URL}?` +
    "latitude=33.5902&longitude=130.4017&current_weather=true" +
    "&hourly=precipitation,cloudcover";

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.error(`Error fetching weather: ${response.statusText}`);
      return null;
    }

    const data: WeatherAPIResponse = await response.json();

    const currentTime = data.current_weather?.time;
    const hourlyTimes = data.hourly?.time || [];
    const index = hourlyTimes.findIndex((t) => t === currentTime);

    if (
      index === -1 ||
      !data.current_weather ||
      !data.hourly?.precipitation ||
      !data.hourly?.cloudcover
    ) {
      console.error("Current time not found in hourly data or data is incomplete");
      return null;
    }

    const precipitation = data.hourly.precipitation[index];
    const cloudcover = data.hourly.cloudcover[index];

    if (precipitation === undefined || cloudcover === undefined) {
      console.error("Weather data for current time is incomplete");
      return null;
    }

    return {
      temperature: data.current_weather.temperature,
      precipitation,
      cloudcover,
      timestamp: currentTime!,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error fetching weather: ${errorMessage}`);
    return null;
  }
}

async function getCachedWeatherData(env: Env): Promise<CachedWeatherData | null> {
  try {
    const cached = await env.WEATHER_CACHE.get(CACHE_KEY);
    if (!cached) return null;
    
    return JSON.parse(cached) as CachedWeatherData;
  } catch (err) {
    console.error("Error reading from cache:", err);
    return null;
  }
}

async function setCachedWeatherData(env: Env, data: CachedWeatherData): Promise<void> {
  try {
    await env.WEATHER_CACHE.put(
      CACHE_KEY,
      JSON.stringify(data),
      { expirationTtl: CACHE_TTL }
    );
  } catch (err) {
    console.error("Error writing to cache:", err);
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...corsHeaders,
          "Access-Control-Allow-Headers":
            request.headers.get("Access-Control-Request-Headers") || "",
        },
      });
    }

    try {
      // Try to get cached data first
      let weatherData = await getCachedWeatherData(env);
      
      if (!weatherData) {
        // If no cached data, fetch fresh data
        console.log("No cached data found, fetching fresh weather data");
        weatherData = await fetchWeatherData(env);
        
        if (!weatherData) {
          return new Response("Unable to fetch weather data", {
            status: 503,
            headers: corsHeaders,
          });
        }
        
        // Cache the fresh data
        await setCachedWeatherData(env, weatherData);
      }

      return new Response(JSON.stringify(weatherData), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Unexpected error: ${errorMessage}`);
      return new Response(`Unexpected error: ${errorMessage}`, { 
        status: 500,
        headers: corsHeaders,
      });
    }
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log("Scheduled weather data fetch triggered");
    
    try {
      const weatherData = await fetchWeatherData(env);
      
      if (weatherData) {
        await setCachedWeatherData(env, weatherData);
        console.log("Weather data successfully cached at:", weatherData.lastUpdated);
      } else {
        console.error("Failed to fetch weather data during scheduled run");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error in scheduled weather fetch: ${errorMessage}`);
    }
  },
};
