import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check } from 'lucide-react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode: string;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ isOpen, onClose, roomCode }) => {
  const [qrUrl, setQrUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const joinUrl = `${window.location.origin}?room=${roomCode}`;

  useEffect(() => {
    if (roomCode && isOpen) {
      QRCode.toDataURL(joinUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#18181b',
          light: '#ffffff'
        }
      })
        .then((url) => setQrUrl(url))
        .catch((err) => console.error('Failed to generate QR code:', err));
    }
  }, [roomCode, joinUrl, isOpen]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-[#0e0e10] border border-white/10 p-6 text-white">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/5 transition"
        >
          <X size={18} />
        </button>

        <div className="text-center mb-5">
          <h3 className="text-lg font-semibold tracking-tight">Scan to join</h3>
          <p className="text-sm text-zinc-500 mt-1">
            Scan this code or enter room code <span className="font-mono text-zinc-300">{roomCode}</span>
          </p>
        </div>

        <div className="flex flex-col items-center justify-center bg-white p-4 rounded-xl">
          {qrUrl ? (
            <img src={qrUrl} alt={`Join room ${roomCode}`} className="w-48 h-48 rounded-lg object-contain" />
          ) : (
            <div className="w-48 h-48 flex items-center justify-center text-zinc-400 text-sm">
              Generating…
            </div>
          )}
          <p className="text-2xl font-mono font-semibold text-zinc-900 tracking-wider mt-3">{roomCode}</p>
        </div>

        <div className="mt-4 flex items-center gap-2 bg-black/30 p-2 rounded-lg border border-white/10">
          <input
            type="text"
            readOnly
            value={joinUrl}
            className="w-full bg-transparent text-xs text-zinc-400 font-mono px-2 focus:outline-none truncate"
          />
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-black font-medium text-xs transition shrink-0 hover:bg-zinc-200"
          >
            {copied ? (
              <>
                <Check size={13} /> Copied
              </>
            ) : (
              <>
                <Copy size={13} /> Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
