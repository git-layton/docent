import React, { useEffect, useState } from 'react';

type TimeOfDay = 'night' | 'sunrise' | 'day' | 'sunset';

export const DynamicBackground: React.FC = () => {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const [timeProgress, setTimeProgress] = useState(0); // 0 to 1 for sun/moon position

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const mins = now.getMinutes();
      const currentDecimalTime = hours + mins / 60;
      
      let newTimeOfDay: TimeOfDay = 'night';
      let progress = 0;

      if (currentDecimalTime >= 5 && currentDecimalTime < 8) {
        newTimeOfDay = 'sunrise';
        progress = (currentDecimalTime - 5) / 3;
      } else if (currentDecimalTime >= 8 && currentDecimalTime < 17) {
        newTimeOfDay = 'day';
        progress = (currentDecimalTime - 8) / 9;
      } else if (currentDecimalTime >= 17 && currentDecimalTime < 20) {
        newTimeOfDay = 'sunset';
        progress = (currentDecimalTime - 17) / 3;
      } else {
        newTimeOfDay = 'night';
        if (currentDecimalTime >= 20) {
          progress = (currentDecimalTime - 20) / 9;
        } else {
          progress = (currentDecimalTime + 4) / 9;
        }
      }

      setTimeOfDay(newTimeOfDay);
      setTimeProgress(progress);
    };

    updateTime();
    const interval = setInterval(updateTime, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Gradient maps
  const skyGradients: Record<TimeOfDay, string> = {
    night: 'linear-gradient(to bottom, #060814 0%, #151a30 50%, #1c1836 100%)',
    sunrise: 'linear-gradient(to bottom, #2b3964 0%, #a46d78 50%, #f69d7b 100%)',
    day: 'linear-gradient(to bottom, #4a8deb 0%, #7db9f7 60%, #a9d9fa 100%)',
    sunset: 'linear-gradient(to bottom, #202b54 0%, #873e5a 40%, #e06c55 80%, #f9a365 100%)',
  };

  const isDark = timeOfDay === 'night' || timeOfDay === 'sunrise' || timeOfDay === 'sunset';

  return (
    <div 
      className="fixed inset-0 z-[-2] overflow-hidden transition-all duration-[3000ms] ease-in-out"
      style={{ background: skyGradients[timeOfDay] }}
    >
      {/* Stars */}
      <div 
        className="absolute inset-0 transition-opacity duration-[3000ms]"
        style={{ 
          opacity: timeOfDay === 'night' ? 1 : timeOfDay === 'sunrise' || timeOfDay === 'sunset' ? 0.4 : 0,
          background: 'transparent'
        }}
      >
        {/* Generate some static stars */}
        {[...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              top: `${Math.random() * 60}%`,
              left: `${Math.random() * 100}%`,
              width: `${Math.random() * 2 + 1}px`,
              height: `${Math.random() * 2 + 1}px`,
              opacity: Math.random() * 0.8 + 0.2,
              animation: `twinkle ${Math.random() * 4 + 2}s infinite alternate`
            }}
          />
        ))}
      </div>

      {/* Sun / Moon */}
      <div 
        className="absolute rounded-full transition-all duration-[3000ms]"
        style={{
          width: '80px',
          height: '80px',
          // Arc calculation: x from left to right, y peaks at middle
          left: `${10 + timeProgress * 80}%`,
          top: `${60 - Math.sin(timeProgress * Math.PI) * 40}%`,
          background: timeOfDay === 'night' ? '#edf2f7' : (timeOfDay === 'day' ? '#fdf8c9' : '#f9d29d'),
          boxShadow: timeOfDay === 'night' 
            ? '0 0 40px rgba(237, 242, 247, 0.4)'
            : '0 0 60px rgba(253, 248, 201, 0.6)',
        }}
      />

      {/* Minimalist Mountains */}
      <div className="absolute bottom-0 w-full h-[40vh] min-h-[300px]">
        {/* Back mountain */}
        <svg 
          viewBox="0 0 1440 320" 
          preserveAspectRatio="none" 
          className="absolute bottom-0 w-full h-full transition-colors duration-[3000ms]"
        >
          <path 
            fill={isDark ? '#141829' : '#6b92c2'} 
            d="M0,256L60,229.3C120,203,240,149,360,154.7C480,160,600,224,720,234.7C840,245,960,203,1080,186.7C1200,171,1320,181,1380,186.7L1440,192L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          ></path>
        </svg>
        
        {/* Front mountain */}
        <svg 
          viewBox="0 0 1440 320" 
          preserveAspectRatio="none" 
          className="absolute bottom-0 w-full h-[80%] transition-colors duration-[3000ms]"
        >
          <path 
            fill={isDark ? '#0b0d18' : '#4d75a6'} 
            d="M0,160L80,181.3C160,203,320,245,480,240C640,235,800,181,960,165.3C1120,149,1280,171,1360,181.3L1440,192L1440,320L1360,320C1280,320,1120,320,960,320C800,320,640,320,480,320C320,320,160,320,80,320L0,320Z"
          ></path>
        </svg>
      </div>

      <style>{`
        @keyframes twinkle {
          0% { transform: scale(1); opacity: 0.2; }
          100% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
