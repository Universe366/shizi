import { useEffect, useRef, useState } from 'react';
import type { Weather } from './model';

/** 起始页天气：城市/开关随设置走，支持手动强制刷新。 */
export function useStartWeather(onError: () => void) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherAt, setWeatherAt] = useState<number | null>(null);
  const [weatherOn, setWeatherOn] = useState(true);
  const [city, setCity] = useState('上海');
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!weatherOn) return;
    let alive = true;
    void window.bsub.startWeather(city, false).then((response) => {
      if (!alive) return;
      setWeather(response.ok ? response.data : null);
      if (response.ok) setWeatherAt(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [weatherOn, city]);

  const refresh = async () => {
    const response = await window.bsub.startWeather(city, true);
    if (response.ok) {
      setWeather(response.data);
      setWeatherAt(Date.now());
    } else {
      errorRef.current();
    }
  };

  const apply = (general: Record<string, unknown>) => {
    setWeatherOn(general.startWeather !== false);
    setCity(String(general.startCity || '上海'));
  };

  return { weather, weatherAt, weatherOn, setWeatherOn, city, setCity, refresh, apply };
}
