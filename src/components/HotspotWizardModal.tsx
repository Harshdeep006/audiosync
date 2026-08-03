import React, { useState, useEffect } from 'react';
import { X, Wifi, Smartphone, ArrowRight, ArrowLeft, CheckCircle2, RefreshCw, Zap } from 'lucide-react';

interface HotspotWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReadyToCreateRoom: () => void;
  isDarkMode: boolean;
}

type Platform = 'android' | 'iphone';

const HOTSPOT_STEPS: Record<Platform, string> = {
  android: 'Settings → Network & Internet → Hotspot & Tethering → Wi-Fi Hotspot → turn on',
  iphone: 'Settings → Personal Hotspot → turn on "Allow Others to Join"'
};

export const HotspotWizardModal: React.FC<HotspotWizardModalProps> = ({
  isOpen,
  onClose,
  onReadyToCreateRoom,
  isDarkMode
}) => {
  const [step, setStep] = useState<number>(1);
  const [platform, setPlatform] = useState<Platform>('android');
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [checkedOnce, setCheckedOnce] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setLocalAddress(null);
      setCheckedOnce(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const checkLocalMode = () => {
    setIsChecking(true);
    fetch('/api/local-network-info')
      .then((res) => res.json())
      .then((data) => {
        setCheckedOnce(true);
        if (data.isLikelyLocal && data.addresses && data.addresses.length > 0) {
          setLocalAddress(`http://${data.addresses[0]}:${data.port}`);
        } else {
          setLocalAddress(null);
        }
      })
      .catch(() => {
        setCheckedOnce(true);
        setLocalAddress(null);
      })
      .finally(() => setIsChecking(false));
  };

  const card = isDarkMode ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white';
  const subtle = isDarkMode ? 'text-zinc-500' : 'text-zinc-500';
  const primaryBtn = isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700';
  const secondaryBtn = isDarkMode ? 'border-white/10 hover:bg-white/5 text-zinc-300' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`relative w-full max-w-lg rounded-xl border p-6 ${
        isDarkMode ? 'bg-[#0e0e10] border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
      }`}>
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-1.5 rounded-md transition ${
            isDarkMode ? 'text-zinc-500 hover:text-white hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
          }`}>
            <Zap size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold tracking-tight">Best-sync setup</h3>
            <p className={`text-xs ${subtle}`}>Step {step} of 4</p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-6 mt-4">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className={`h-1 flex-1 rounded-full ${
              s <= step ? (isDarkMode ? 'bg-white' : 'bg-zinc-900') : (isDarkMode ? 'bg-white/10' : 'bg-zinc-200')
            }`} />
          ))}
        </div>

        {/* Step 1: Why */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed">
              Playing over the internet works anywhere, but timing can drift over a long song since it depends on a distant server. Hosting from your own phone's hotspot removes that entirely — every device talks directly to each other, which gives the tightest possible sync.
            </p>
            <p className={`text-xs ${subtle}`}>
              This takes about a minute to set up. Your regular internet link still works fine any time you'd rather skip this.
            </p>
            <button
              onClick={() => setStep(2)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition ${primaryBtn}`}
            >
              Get started <ArrowRight size={15} />
            </button>
          </div>
        )}

        {/* Step 2: Turn on hotspot */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Smartphone size={16} className={subtle} />
              <p className="text-sm font-medium">On the phone that will host the hotspot:</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPlatform('android')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                  platform === 'android'
                    ? (isDarkMode ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-700')
                    : secondaryBtn
                }`}
              >
                Android
              </button>
              <button
                onClick={() => setPlatform('iphone')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                  platform === 'iphone'
                    ? (isDarkMode ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-700')
                    : secondaryBtn
                }`}
              >
                iPhone
              </button>
            </div>

            <div className={`p-3 rounded-lg border text-sm font-mono leading-relaxed ${card}`}>
              {HOTSPOT_STEPS[platform]}
            </div>

            <p className={`text-xs ${subtle}`}>Menu wording varies a little by phone model, but this is the general path.</p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep(1)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${secondaryBtn}`}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                onClick={() => setStep(3)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition ${primaryBtn}`}
              >
                Hotspot is on <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Connect this device */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Wifi size={16} className={subtle} />
              <p className="text-sm font-medium">Now connect THIS device to that hotspot</p>
            </div>
            <p className={`text-sm leading-relaxed ${subtle}`}>
              Open WiFi settings on the device you're using right now, and join the hotspot network you just turned on (it may briefly disconnect from your current WiFi — that's expected).
            </p>
            <p className={`text-xs ${subtle}`}>
              If this device <span className="font-medium">is</span> the hotspot phone, you can skip this step.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep(2)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${secondaryBtn}`}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                onClick={() => { setStep(4); checkLocalMode(); }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition ${primaryBtn}`}
              >
                I'm connected <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Verify + hand off */}
        {step === 4 && (
          <div className="space-y-4">
            {isChecking && (
              <div className="flex items-center gap-2 text-sm">
                <RefreshCw size={15} className="animate-spin" /> Checking connection…
              </div>
            )}

            {!isChecking && localAddress && (
              <div className="space-y-4">
                <div className={`p-3 rounded-lg border flex items-center gap-2 text-sm ${
                  isDarkMode ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                }`}>
                  <CheckCircle2 size={16} /> You're set up for best-sync mode
                </div>
                <p className={`text-xs ${subtle}`}>
                  Create your room now, then share the QR code — tell your guests to join the hotspot WiFi first, then scan it.
                </p>
                <button
                  onClick={() => { onReadyToCreateRoom(); onClose(); }}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition ${primaryBtn}`}
                >
                  Create room <ArrowRight size={15} />
                </button>
              </div>
            )}

            {!isChecking && !localAddress && checkedOnce && (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed">
                  This device is on the hotspot now, but this page is still loading over the regular internet link rather than running locally — best-sync mode needs the app running directly on a device on this network.
                </p>
                <p className={`text-xs ${subtle}`}>
                  If you have the project set up on this laptop, run <span className="font-mono">start-local.bat</span> now, then open the address it shows you and come back to this step.
                </p>
                <button
                  onClick={checkLocalMode}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm border transition ${secondaryBtn}`}
                >
                  <RefreshCw size={14} /> Check again
                </button>
                <button
                  onClick={() => { onReadyToCreateRoom(); onClose(); }}
                  className={`w-full px-4 py-2 rounded-lg text-xs font-medium underline underline-offset-4 ${subtle}`}
                >
                  Skip and use the regular link instead
                </button>
              </div>
            )}

            <button
              onClick={() => setStep(3)}
              className={`text-xs font-medium ${subtle} hover:underline`}
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
