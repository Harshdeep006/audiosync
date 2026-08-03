import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../lib/audioEngine';

interface AudioSpectrumCanvasProps {
  isPlaying: boolean;
  isDarkMode: boolean;
  className?: string;
}

export const AudioSpectrumCanvas: React.FC<AudioSpectrumCanvasProps> = ({
  isPlaying,
  isDarkMode,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const freqData = audioEngine.getFrequencyData();
      const numBars = Math.min(64, freqData.length);
      const barWidth = (width / numBars) - 2;

      for (let i = 0; i < numBars; i++) {
        let value = isPlaying ? freqData[i] : (Math.sin(Date.now() / 200 + i * 0.2) * 15 + 20);
        const percent = value / 255;
        const barHeight = Math.max(4, percent * height * 0.85);
        const x = i * (barWidth + 2);
        const y = height - barHeight;

        ctx.fillStyle = isDarkMode ? 'rgba(244, 244, 245, 0.85)' : 'rgba(24, 24, 27, 0.75)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={140}
      className={`w-full h-28 rounded-lg ${
        isDarkMode ? 'bg-black/30 border border-white/5' : 'bg-zinc-50 border border-zinc-200'
      } ${className}`}
    />
  );
};
