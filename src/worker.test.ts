import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from './worker';

// Mock the environment
const mockEnv = {
  API_URL: 'https://api.open-meteo.com/v1/forecast',
  WEATHER_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
  },
};

// Mock fetch
global.fetch = vi.fn();

describe('Weather Worker with Caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return cached weather data when available', async () => {
    const cachedData = {
      temperature: 25.5,
      precipitation: 0.2,
      cloudcover: 30,
      timestamp: '2025-06-26T12:00',
      lastUpdated: '2025-06-26T12:00:00.000Z',
    };

    mockEnv.WEATHER_CACHE.get.mockResolvedValue(JSON.stringify(cachedData));

    const response = await worker.fetch(
      new Request('http://localhost/'),
      mockEnv as any,
      {} as any
    );
    
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data).toEqual(cachedData);
    expect(mockEnv.WEATHER_CACHE.get).toHaveBeenCalledWith('weather_fukuoka');
    expect(fetch).not.toHaveBeenCalled(); // Should not fetch from API
  });

  it('should fetch fresh data when cache is empty', async () => {
    const apiResponse = {
      current_weather: {
        temperature: 23.1,
        time: '2025-06-26T12:00',
      },
      hourly: {
        time: ['2025-06-26T12:00', '2025-06-26T13:00'],
        precipitation: [0.1, 0.2],
        cloudcover: [25, 35],
      },
    };

    mockEnv.WEATHER_CACHE.get.mockResolvedValue(null);
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiResponse),
    });

    const response = await worker.fetch(
      new Request('http://localhost/'),
      mockEnv as any,
      {} as any
    );
    
    const data = await response.json() as any;
    
    expect(response.status).toBe(200);
    expect(data.temperature).toBe(23.1);
    expect(data.precipitation).toBe(0.1);
    expect(data.cloudcover).toBe(25);
    expect(data.timestamp).toBe('2025-06-26T12:00');
    expect(mockEnv.WEATHER_CACHE.put).toHaveBeenCalled();
  });

  it('should handle CORS preflight requests', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/', { method: 'OPTIONS' }),
      mockEnv as any,
      {} as any
    );
    
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should handle API errors gracefully', async () => {
    mockEnv.WEATHER_CACHE.get.mockResolvedValue(null);
    (fetch as any).mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
    });

    const response = await worker.fetch(
      new Request('http://localhost/'),
      mockEnv as any,
      {} as any
    );
    
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toBe('Unable to fetch weather data');
  });

  it('should handle scheduled events', async () => {
    const apiResponse = {
      current_weather: {
        temperature: 20.5,
        time: '2025-06-26T16:00',
      },
      hourly: {
        time: ['2025-06-26T16:00', '2025-06-26T17:00'],
        precipitation: [0.0, 0.1],
        cloudcover: [10, 20],
      },
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiResponse),
    });

    const scheduledEvent = {
      type: 'scheduled',
      scheduledTime: new Date().getTime(),
      cron: '0 */4 * * *',
    } as ScheduledEvent;

    await worker.scheduled(scheduledEvent, mockEnv as any, {} as any);
    
    expect(fetch).toHaveBeenCalled();
    expect(mockEnv.WEATHER_CACHE.put).toHaveBeenCalled();
  });
});
