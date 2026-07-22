import React, { useEffect, useState, useMemo } from 'react';
import { useWeatherStore, weatherCondition, weatherSeverity, type WeatherCondition } from '../store/useWeatherStore';
import { useSettingsStore } from '../store/useSettingsStore';

type TimeOfDay = 'night' | 'sunrise' | 'day' | 'sunset';

// Stable random seed per mount so stars/clouds don't jump on re-render
const seededRandom = (seed: number) => {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
};

/** Parse an ISO time string to decimal hours (e.g. "2026-07-17T20:15" → 20.25) */
const isoToDecimalHours = (iso: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getHours() + d.getMinutes() / 60;
};

export const DynamicBackground: React.FC = () => {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const [timeProgress, setTimeProgress] = useState(0);

  // Weather-driven conditions
  const weatherCode = useWeatherStore(s => s.weatherCode);
  const sunrise = useWeatherStore(s => s.sunrise);
  const sunset = useWeatherStore(s => s.sunset);
  const condition: WeatherCondition = weatherCondition(weatherCode);
  const severity = weatherSeverity(weatherCode);
  const ambientWeatherEnabled = useSettingsStore(s => s.appSettings.ambientWeatherEnabled ?? true);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const mins = now.getMinutes();
      const currentDecimalTime = hours + mins / 60;

      // Use real sunrise/sunset if available, otherwise fallback to defaults
      const sunriseTime = isoToDecimalHours(sunrise) ?? 6;
      const sunsetTime = isoToDecimalHours(sunset) ?? 20;
      const sunriseEnd = sunriseTime + 1.5;   // transition window after sunrise
      const sunsetStart = sunsetTime - 1.5;    // transition window before sunset

      let newTimeOfDay: TimeOfDay = 'night';
      let progress = 0;

      if (currentDecimalTime >= sunriseTime && currentDecimalTime < sunriseEnd) {
        newTimeOfDay = 'sunrise';
        progress = (currentDecimalTime - sunriseTime) / (sunriseEnd - sunriseTime);
      } else if (currentDecimalTime >= sunriseEnd && currentDecimalTime < sunsetStart) {
        newTimeOfDay = 'day';
        progress = (currentDecimalTime - sunriseEnd) / (sunsetStart - sunriseEnd);
      } else if (currentDecimalTime >= sunsetStart && currentDecimalTime < sunsetTime) {
        newTimeOfDay = 'sunset';
        progress = (currentDecimalTime - sunsetStart) / (sunsetTime - sunsetStart);
      } else {
        newTimeOfDay = 'night';
        if (currentDecimalTime >= sunsetTime) {
          progress = (currentDecimalTime - sunsetTime) / (24 - sunsetTime + sunriseTime);
        } else {
          progress = (currentDecimalTime + 24 - sunsetTime) / (24 - sunsetTime + sunriseTime);
        }
      }

      setTimeOfDay(newTimeOfDay);
      setTimeProgress(progress);
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [sunrise, sunset]);

  // Stable star positions
  const stars = useMemo(() =>
    [...Array(50)].map((_, i) => ({
      top: `${seededRandom(i * 3) * 60}%`,
      left: `${seededRandom(i * 3 + 1) * 100}%`,
      size: `${seededRandom(i * 3 + 2) * 2 + 1}px`,
      opacity: seededRandom(i * 7) * 0.8 + 0.2,
      duration: `${seededRandom(i * 5) * 4 + 2}s`,
    })), []);

  // Shooting star configs
  const shootingStars = useMemo(() =>
    [0, 1, 2].map(i => ({
      top: `${8 + seededRandom(i * 99) * 30}%`,
      left: `${seededRandom(i * 99 + 50) * 60 + 20}%`,
      delay: `${i * 9 + seededRandom(i * 99 + 25) * 6}s`,
      duration: `${18 + seededRandom(i * 99 + 75) * 12}s`,
      angle: -25 - seededRandom(i * 99 + 33) * 20,
    })), []);

  // Cloud configs
  const clouds = useMemo(() =>
    [...Array(Math.floor(2 + 6 * severity))].map((_, i) => ({
      top: `${8 + seededRandom(i * 77) * 25}%`,
      scale: 0.6 + seededRandom(i * 77 + 1) * 0.8,
      opacity: 0.25 + seededRandom(i * 77 + 2) * 0.35,
      duration: `${80 + seededRandom(i * 77 + 3) * 100}s`,
      delay: `${-seededRandom(i * 77 + 4) * 80}s`,
    })), [severity]);

  // Bird configs
  const birds = useMemo(() =>
    [0, 1, 2].map(i => ({
      top: `${12 + seededRandom(i * 55) * 22}%`,
      scale: 0.4 + seededRandom(i * 55 + 1) * 0.4,
      duration: `${25 + seededRandom(i * 55 + 2) * 20}s`,
      delay: `${seededRandom(i * 55 + 3) * 30}s`,
      flapSpeed: `${0.3 + seededRandom(i * 55 + 4) * 0.3}s`,
    })), []);

  // Raindrop configs (for drizzle/rain/thunderstorm)
  const raindrops = useMemo(() =>
    [...Array(Math.floor(20 + 100 * severity))].map((_, i) => ({
      left: `${seededRandom(i * 11) * 100}%`,
      delay: `${seededRandom(i * 11 + 1) * 2}s`,
      duration: `${0.4 + seededRandom(i * 11 + 2) * 0.4}s`,
      opacity: 0.15 + seededRandom(i * 11 + 3) * 0.35,
      width: condition === 'drizzle' ? '1px' : '1.5px',
      height: condition === 'drizzle' ? '12px' : '20px',
    })), [condition]);

  // Snowflake configs
  const snowflakes = useMemo(() =>
    [...Array(Math.floor(10 + 60 * severity))].map((_, i) => ({
      left: `${seededRandom(i * 13) * 100}%`,
      delay: `${seededRandom(i * 13 + 1) * 6}s`,
      duration: `${4 + seededRandom(i * 13 + 2) * 4}s`,
      size: `${2 + seededRandom(i * 13 + 3) * 4}px`,
      drift: `${-20 + seededRandom(i * 13 + 4) * 40}px`,
      opacity: 0.4 + seededRandom(i * 13 + 5) * 0.5,
    })), [severity]);

  const skyGradients: Record<TimeOfDay, string> = {
    night: 'linear-gradient(to bottom, #060814 0%, #151a30 50%, #1c1836 100%)',
    sunrise: 'linear-gradient(to bottom, #2b3964 0%, #a46d78 50%, #f69d7b 100%)',
    day: 'linear-gradient(to bottom, #4a8deb 0%, #7db9f7 60%, #a9d9fa 100%)',
    sunset: 'linear-gradient(to bottom, #202b54 0%, #873e5a 40%, #e06c55 80%, #f9a365 100%)',
  };

  // Overcast/storm gradients overlay
  const stormGradients: Partial<Record<WeatherCondition, Record<TimeOfDay, string>>> = {
    rain: {
      night: 'linear-gradient(to bottom, #050810 0%, #0d1020 50%, #121625 100%)',
      sunrise: 'linear-gradient(to bottom, #2a3050 0%, #6e5565 50%, #9e7a6e 100%)',
      day: 'linear-gradient(to bottom, #5a6a7e 0%, #7a8a98 60%, #8e9eaa 100%)',
      sunset: 'linear-gradient(to bottom, #1e2540 0%, #5e3848 40%, #8e5548 80%, #b88060 100%)',
    },
    thunderstorm: {
      night: 'linear-gradient(to bottom, #030508 0%, #0a0d18 50%, #0e1018 100%)',
      sunrise: 'linear-gradient(to bottom, #222840 0%, #554550 50%, #7a6560 100%)',
      day: 'linear-gradient(to bottom, #3a4858 0%, #556070 60%, #6a7888 100%)',
      sunset: 'linear-gradient(to bottom, #181e35 0%, #4a2e3e 40%, #6e4540 80%, #987055 100%)',
    },
    cloudy: {
      night: 'linear-gradient(to bottom, #080c18 0%, #181e30 50%, #1e2238 100%)',
      sunrise: 'linear-gradient(to bottom, #2e3858 0%, #8a6670 50%, #d89070 100%)',
      day: 'linear-gradient(to bottom, #6090c8 0%, #8ab0d8 60%, #a0c4e4 100%)',
      sunset: 'linear-gradient(to bottom, #242a48 0%, #704050 40%, #c06050 80%, #e8985a 100%)',
    },
  };

  const activeSky = stormGradients[condition]?.[timeOfDay] ?? skyGradients[timeOfDay];

  // Publish how bright the wallpaper currently is, so CSS can pick ink from the SKY
  // rather than from the theme. Every surface above the wallpaper is translucent, so
  // what text is actually read against is the sky — and the sky swings from #7db9f7
  // at noon to #151a30 at night. A theme-fixed ink ramp fails at one end or the
  // other (measured: light ink is 1.22:1 on the night sky; dark ink 1.81:1 at midday).
  // Luminance is read off the gradient itself rather than mapped from the clock, so
  // storm/overcast variants — which darken the sky independently of time — come along
  // for free.
  useEffect(() => {
    const stops = activeSky.match(/#[0-9a-f]{6}/gi) ?? [];
    const mid = stops[Math.floor(stops.length / 2)] ?? '#7db9f7';
    const channel = (i: number) => {
      const c = parseInt(mid.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
    // 0.25, not the midpoint. Sunrise (#a46d78) sits at 0.202 and is the worst
    // backdrop in the set — mid-tone, so neither ink wins on it. Classifying it
    // dim and treating it with light ink on a dark plate takes the tightest
    // measurement in the whole system from 2.88:1 to 4.89:1. Lower this and
    // sunrise falls back below AA.
    document.documentElement.setAttribute('data-sky', luminance > 0.25 ? 'bright' : 'dim');
  }, [activeSky]);
  const isDark = timeOfDay === 'night' || timeOfDay === 'sunrise' || timeOfDay === 'sunset';
  const showClouds = ambientWeatherEnabled && (timeOfDay === 'day' || timeOfDay === 'sunrise' || timeOfDay === 'sunset');
  const showBirds = ambientWeatherEnabled && timeOfDay === 'day' && (condition === 'clear' || condition === 'cloudy');
  const showShootingStars = ambientWeatherEnabled && timeOfDay === 'night' && condition === 'clear';
  const showRain = ambientWeatherEnabled && (condition === 'rain' || condition === 'drizzle' || condition === 'thunderstorm');
  const showSnow = ambientWeatherEnabled && condition === 'snow';
  const showFog = ambientWeatherEnabled && condition === 'fog';
  const showLightning = ambientWeatherEnabled && condition === 'thunderstorm';
  // Extra clouds for overcast/rainy conditions
  const cloudDensity = (condition === 'cloudy' || condition === 'rain' || condition === 'thunderstorm') ? 1.6 : 1;

  return (
    <div
      className="fixed inset-0 z-[-2] overflow-hidden transition-all duration-[3000ms] ease-in-out"
      style={{ background: activeSky }}
    >
      {/* Stars */}
      <div
        className="absolute inset-0 transition-opacity duration-[3000ms]"
        style={{
          opacity: timeOfDay === 'night'
            ? (condition === 'clear' ? 1 : condition === 'cloudy' ? 0.3 : 0.1)
            : timeOfDay === 'sunrise' || timeOfDay === 'sunset' ? 0.4 : 0,
          background: 'transparent'
        }}
      >
        {stars.map((star, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              top: star.top,
              left: star.left,
              width: star.size,
              height: star.size,
              opacity: star.opacity,
              animation: `twinkle ${star.duration} infinite alternate`
            }}
          />
        ))}
      </div>

      {/* Shooting Stars */}
      {showShootingStars && shootingStars.map((ss, i) => (
        <div
          key={`ss-${i}`}
          className="absolute"
          style={{
            top: ss.top,
            left: ss.left,
            // `rotate`, not `transform: rotate()`. The keyframe animates `transform`, which
            // overrides an inline transform completely — so the star snapped upright the instant
            // the animation applied and then flew flat sideways instead of along its angle. As an
            // independent property the rotation composes with the animated translate, and the
            // streak finally travels in the direction it points.
            rotate: `${ss.angle}deg`,
            animation: `shootingStar ${ss.duration} ${ss.delay} infinite`,
          }}
        >
          <div style={{
            width: '80px', height: '1.5px',
            background: 'linear-gradient(to left, rgba(255,255,255,0.9), rgba(255,255,255,0.4) 30%, transparent)',
            borderRadius: '1px', boxShadow: '0 0 6px rgba(255,255,255,0.4)',
          }} />
        </div>
      ))}

      {/* Drifting Clouds */}
      {showClouds && clouds.map((cloud, i) => (
        <div
          key={`cloud-${i}`}
          className="absolute pointer-events-none"
          style={{
            top: cloud.top,
            // `scale`, not `transform: scale()` — the drift animation owns `transform`, and an
            // animated transform overrides an inline one outright rather than composing with it.
            scale: `${cloud.scale * cloudDensity}`,
            opacity: timeOfDay === 'day' ? cloud.opacity * cloudDensity : cloud.opacity * 0.5,
            animation: `drift ${cloud.duration} ${cloud.delay} linear infinite`,
          }}
        >
          <div style={{ position: 'relative', width: '120px', height: '40px' }}>
            <div style={{
              position: 'absolute', borderRadius: '50%',
              background: timeOfDay === 'day' ? 'rgba(255,255,255,0.7)' : 'rgba(255,200,160,0.3)',
              width: '60px', height: '30px', top: '10px', left: '0',
            }} />
            <div style={{
              position: 'absolute', borderRadius: '50%',
              background: timeOfDay === 'day' ? 'rgba(255,255,255,0.8)' : 'rgba(255,200,160,0.35)',
              width: '80px', height: '35px', top: '2px', left: '20px',
            }} />
            <div style={{
              position: 'absolute', borderRadius: '50%',
              background: timeOfDay === 'day' ? 'rgba(255,255,255,0.65)' : 'rgba(255,200,160,0.25)',
              width: '50px', height: '25px', top: '12px', left: '65px',
            }} />
          </div>
        </div>
      ))}

      {/* Rain */}
      {showRain && (
        <div className="absolute inset-0 pointer-events-none">
          {raindrops.map((drop, i) => (
            <div
              key={`rain-${i}`}
              className="absolute"
              style={{
                left: drop.left,
                top: '-20px',
                width: drop.width,
                height: drop.height,
                borderRadius: '1px',
                background: `linear-gradient(to bottom, transparent, rgba(180,200,220,${drop.opacity}))`,
                animation: `rainfall ${drop.duration} ${drop.delay} linear infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* Snow */}
      {showSnow && (
        <div className="absolute inset-0 pointer-events-none">
          {snowflakes.map((flake, i) => (
            <div
              key={`snow-${i}`}
              className="absolute rounded-full"
              style={{
                left: flake.left,
                top: '-10px',
                width: flake.size,
                height: flake.size,
                background: `rgba(255,255,255,${flake.opacity})`,
                animation: `snowfall ${flake.duration} ${flake.delay} linear infinite`,
                ['--snow-drift' as string]: flake.drift,
              }}
            />
          ))}
        </div>
      )}

      {/* Fog */}
      {showFog && (
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0"
            style={{
              background: isDark
                ? `linear-gradient(to top, rgba(30,35,50,${0.2 + 0.4 * severity}) 0%, rgba(30,35,50,${0.1 + 0.1 * severity}) 50%, transparent 80%)`
                : `linear-gradient(to top, rgba(200,210,220,${0.2 + 0.3 * severity}) 0%, rgba(200,210,220,${0.1 + 0.1 * severity}) 50%, transparent 80%)`,
              animation: 'fogPulse 8s ease-in-out infinite alternate',
            }}
          />
        </div>
      )}

      {/* Lightning flashes (thunderstorm only) */}
      {showLightning && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ animation: 'lightning 6s infinite' }}
        />
      )}

      {/* Birds */}
      {showBirds && birds.map((bird, i) => (
        <div
          key={`bird-${i}`}
          className="absolute pointer-events-none"
          style={{
            top: bird.top,
            animation: `drift ${bird.duration} ${bird.delay} linear infinite`,
            // See the cloud above: independent `scale` so drift's transform doesn't clobber it.
            scale: `${bird.scale}`,
          }}
        >
          <svg width="20" height="8" viewBox="0 0 20 8" fill="none"
            style={{ animation: `flap ${bird.flapSpeed} ease-in-out infinite alternate` }}
          >
            <path d="M0 0 Q5 6 10 4 Q15 6 20 0" stroke="rgba(30,40,60,0.5)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      ))}

      {/* Sun / Moon */}
      <div
        className="absolute rounded-full transition-all duration-[3000ms]"
        style={{
          width: '80px', height: '80px',
          left: `${10 + timeProgress * 80}%`,
          top: `${60 - Math.sin(timeProgress * Math.PI) * 40}%`,
          background: timeOfDay === 'night' ? '#edf2f7' : (timeOfDay === 'day' ? '#fdf8c9' : '#f9d29d'),
          boxShadow: timeOfDay === 'night'
            ? '0 0 40px rgba(237, 242, 247, 0.4)'
            : '0 0 60px rgba(253, 248, 201, 0.6)',
          // Dim the sun/moon behind clouds/rain
          opacity: (condition === 'rain' || condition === 'thunderstorm') ? 0.2
            : condition === 'cloudy' ? 0.5
            : condition === 'fog' ? 0.3
            : 1,
        }}
      />

      {/* Minimalist Mountains */}
      <div className="absolute bottom-0 w-full h-[40vh] min-h-[300px]">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="absolute bottom-0 w-full h-full transition-colors duration-[3000ms]">
          <path fill={isDark ? '#141829' : '#6b92c2'} d="M0,256L60,229.3C120,203,240,149,360,154.7C480,160,600,224,720,234.7C840,245,960,203,1080,186.7C1200,171,1320,181,1380,186.7L1440,192L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z" />
        </svg>
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="absolute bottom-0 w-full h-[80%] transition-colors duration-[3000ms]">
          <path fill={isDark ? '#0b0d18' : '#4d75a6'} d="M0,160L80,181.3C160,203,320,245,480,240C640,235,800,181,960,165.3C1120,149,1280,171,1360,181.3L1440,192L1440,320L1360,320C1280,320,1120,320,960,320C800,320,640,320,480,320C320,320,160,320,80,320L0,320Z" />
        </svg>
      </div>

      <style>{`
        @keyframes twinkle {
          0% { transform: scale(1); opacity: 0.2; }
          100% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes shootingStar {
          0%, 92% { opacity: 0; transform: translateX(0); }
          94% { opacity: 1; }
          98% { opacity: 0.8; transform: translateX(180px); }
          100% { opacity: 0; transform: translateX(220px); }
        }
        /* translateX, never left. Animating \`left\` recalculates layout on EVERY frame, for every
           cloud and every bird simultaneously — which is what made the sky stutter and periodically
           freeze. transform is composited off the main thread, so the same motion costs nothing.
           Elements using this set \`scale\`/\`rotate\` via the independent CSS properties rather than
           \`transform: scale()\`, so their sizing composes with this instead of being clobbered. */
        @keyframes drift {
          0% { transform: translateX(-15vw); }
          100% { transform: translateX(110vw); }
        }
        @keyframes flap {
          0% { transform: scaleY(1); }
          100% { transform: scaleY(0.6); }
        }
        @keyframes rainfall {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0.3; }
        }
        @keyframes snowfall {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(100vh) translateX(var(--snow-drift, 0px)); opacity: 0.2; }
        }
        @keyframes fogPulse {
          0% { opacity: 0.6; }
          100% { opacity: 0.85; }
        }
        @keyframes lightning {
          0%, 88%, 92%, 96%, 100% { background: transparent; }
          89% { background: rgba(200,210,255,0.15); }
          93% { background: rgba(200,210,255,0.1); }
        }
      `}</style>
    </div>
  );
};
