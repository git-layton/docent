import React, { useRef, useState } from 'react';

export function InteractiveGlassCard({ children }: { children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Calculate 3D Tilt
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -10; // Max 10 deg tilt
    const rotateY = ((x - centerX) / centerX) * 10;
    
    // Apply dynamic CSS variables for the glow
    setStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
      '--mouse-x': `${x}px`,
      '--mouse-y': `${y}px`,
    } as React.CSSProperties);
  };

  const handleMouseLeave = () => {
    setStyle({ transform: 'perspective(1000px) rotateX(0) rotateY(0)' });
  };

  return (
    <div 
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative overflow-hidden transition-transform duration-200 ease-out bg-panel rounded-xl border border-edge"
      style={style}
    >
      {/* The Glow Layer (Follows Mouse) */}
      <div 
        className="pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle 200px at var(--mouse-x, 0) var(--mouse-y, 0), rgba(167, 139, 250, 0.15), transparent 80%)`
        }}
      />
      
      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
