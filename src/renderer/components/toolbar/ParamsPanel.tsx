import { useState, useRef, useCallback } from 'react';

interface Props {
  mainCamera: 'tele' | 'wide';
}

// Exposure uses discrete index values (0-165) mapped to shutter speeds.
// These are the standard indices from the DWARF3 firmware config.
const EXPOSURE_STEPS = [
  { index: 0, label: '1/10000' },
  { index: 3, label: '1/8000' },
  { index: 6, label: '1/6400' },
  { index: 9, label: '1/5000' },
  { index: 12, label: '1/4000' },
  { index: 15, label: '1/3200' },
  { index: 18, label: '1/2500' },
  { index: 21, label: '1/2000' },
  { index: 24, label: '1/1600' },
  { index: 27, label: '1/1250' },
  { index: 30, label: '1/1000' },
  { index: 33, label: '1/800' },
  { index: 36, label: '1/640' },
  { index: 39, label: '1/500' },
  { index: 42, label: '1/400' },
  { index: 45, label: '1/320' },
  { index: 48, label: '1/250' },
  { index: 51, label: '1/200' },
  { index: 54, label: '1/160' },
  { index: 57, label: '1/125' },
  { index: 60, label: '1/100' },
  { index: 63, label: '1/80' },
  { index: 66, label: '1/60' },
  { index: 69, label: '1/50' },
  { index: 72, label: '1/40' },
  { index: 75, label: '1/30' },
  { index: 78, label: '1/25' },
  { index: 81, label: '1/20' },
  { index: 84, label: '1/15' },
  { index: 87, label: '1/13' },
  { index: 90, label: '1/10' },
  { index: 93, label: '1/8' },
  { index: 96, label: '1/6' },
  { index: 99, label: '1/5' },
  { index: 102, label: '1/4' },
  { index: 105, label: '1/3' },
  { index: 108, label: '0.4s' },
  { index: 111, label: '0.5s' },
  { index: 114, label: '0.6s' },
  { index: 117, label: '0.8s' },
  { index: 120, label: '1s' },
  { index: 123, label: '1.3s' },
  { index: 126, label: '1.6s' },
  { index: 129, label: '2s' },
  { index: 132, label: '2.5s' },
  { index: 135, label: '3.2s' },
  { index: 138, label: '4s' },
  { index: 141, label: '5s' },
  { index: 144, label: '6s' },
  { index: 147, label: '8s' },
  { index: 150, label: '10s' },
  { index: 153, label: '13s' },
  { index: 156, label: '15s' },
  { index: 159, label: '30s' },
  { index: 160, label: '45s' },
  { index: 162, label: '60s' },
  { index: 163, label: '90s' },
  { index: 165, label: '120s' },
] as const;

// Default exposure: index 75 = 1/30s (slider position 25 out of 0-57)
const DEFAULT_EXP_SLIDER = EXPOSURE_STEPS.findIndex((s) => s.index === 75);

interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  setter: (camera: string, value: number) => Promise<void>;
}

// Ranges verified live against firmware v1.5.0.1 via /shootingMode/getParamAndSetting.
// Previously the viewer guessed 0-255 / default 128 for every slider — wildly
// wrong. The firmware silently clamped or dropped out-of-range values, which
// is why "non really do anything" was the symptom.
const PARAMS: ParamDef[] = [
  { key: 'gain', label: 'Gain', min: 0, max: 240, step: 1, defaultValue: 60, setter: (c, v) => window.api.sdk.setGain(c, v) },
  { key: 'brightness', label: 'Brt', min: -100, max: 100, step: 1, defaultValue: 0, setter: (c, v) => window.api.sdk.setBrightness(c, v) },
  { key: 'contrast', label: 'Ctr', min: -100, max: 100, step: 1, defaultValue: 0, setter: (c, v) => window.api.sdk.setContrast(c, v) },
  { key: 'saturation', label: 'Sat', min: -100, max: 100, step: 1, defaultValue: 0, setter: (c, v) => window.api.sdk.setSaturation(c, v) },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0, setter: (c, v) => window.api.sdk.setHue(c, v) },
  { key: 'sharpness', label: 'Shp', min: 0, max: 100, step: 1, defaultValue: 30, setter: (c, v) => window.api.sdk.setSharpness(c, v) },
];

export function ParamsPanel({ mainCamera }: Props) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of PARAMS) init[p.key] = p.defaultValue;
    return init;
  });

  const [expSlider, setExpSlider] = useState(DEFAULT_EXP_SLIDER);
  const [expMode, setExpMode] = useState<'auto' | 'manual'>('auto');
  const [irCut, setIrCut] = useState(false);

  // Burst shot count. Persisted to localStorage and broadcast as a custom
  // event so ControlBar's shutter button picks it up without prop drilling.
  // 1 = single shot (default), 2..20 = burst.
  const [shotCount, setShotCountState] = useState<number>(() => {
    const stored = Number(localStorage.getItem('dwarf.shotCount'));
    return Number.isFinite(stored) && stored >= 1 ? stored : 1;
  });
  const setShotCount = useCallback((n: number) => {
    setShotCountState(n);
    localStorage.setItem('dwarf.shotCount', String(n));
    window.dispatchEvent(new CustomEvent('dwarf:shot-count', { detail: n }));
  }, []);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleChange = useCallback((param: ParamDef, value: number) => {
    setValues((prev) => ({ ...prev, [param.key]: value }));

    if (debounceTimers.current[param.key]) {
      clearTimeout(debounceTimers.current[param.key]);
    }
    debounceTimers.current[param.key] = setTimeout(() => {
      param.setter(mainCamera, value).catch(() => {});
    }, 150);
  }, [mainCamera]);

  const handleExpChange = useCallback((sliderPos: number) => {
    setExpSlider(sliderPos);
    const step = EXPOSURE_STEPS[sliderPos];
    if (!step) return;

    if (debounceTimers.current['exposure']) {
      clearTimeout(debounceTimers.current['exposure']);
    }
    debounceTimers.current['exposure'] = setTimeout(() => {
      window.api.sdk.setExposure(mainCamera, step.index).catch(() => {});
    }, 150);
  }, [mainCamera]);

  const toggleExpMode = async () => {
    const newMode = expMode === 'auto' ? 'manual' : 'auto';
    try {
      await window.api.sdk.setExposureMode(mainCamera, newMode === 'auto' ? 0 : 1);
      setExpMode(newMode);
      // When entering manual, the firmware otherwise keeps whatever auto
      // picked until the user nudges a slider. Re-push the current slider
      // values so what the UI shows is what the camera applies immediately.
      if (newMode === 'manual') {
        const step = EXPOSURE_STEPS[expSlider];
        if (step) {
          window.api.sdk.setExposure(mainCamera, step.index).catch(() => {});
        }
        for (const param of PARAMS) {
          param.setter(mainCamera, values[param.key]).catch(() => {});
        }
      }
    } catch { /* ignore */ }
  };

  const toggleIrCut = async () => {
    const newVal = !irCut;
    try {
      await window.api.sdk.setIRCut(mainCamera, newVal ? 1 : 0);
      setIrCut(newVal);
    } catch { /* ignore */ }
  };

  const currentExpLabel = EXPOSURE_STEPS[expSlider]?.label ?? '?';

  return (
    <div className="flex flex-col gap-2 w-full max-w-2xl">
      {/* Mode toggles row */}
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={toggleExpMode}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            expMode === 'auto' ? 'bg-dwarf-accent/30 text-white' : 'bg-white/10 text-white/50'
          }`}
        >
          Exp: {expMode === 'auto' ? 'Auto' : 'Manual'}
        </button>
        {/* Gain has no auto mode on this hardware (modes=[1]). Manual only. */}
        <button
          onClick={toggleIrCut}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            irCut ? 'bg-red-500/30 text-red-400' : 'bg-white/10 text-white/50'
          }`}
        >
          IR {irCut ? 'On' : 'Off'}
        </button>

        {/* Burst shot count — 1 = single shot, 2..20 = burst. */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] text-white/50">Shots</span>
          <input
            type="number"
            min={1}
            max={20}
            value={shotCount}
            onChange={(e) => {
              const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
              setShotCount(n);
            }}
            className="w-12 px-1.5 py-0.5 text-[10px] font-medium text-white bg-white/10 rounded
              focus:outline-none focus:bg-white/15 text-center tabular-nums"
          />
        </div>
      </div>

      {/* Exposure slider (discrete steps) */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-white/50 w-7 flex-shrink-0">Exp</span>
        <input
          type="range"
          min={0}
          max={EXPOSURE_STEPS.length - 1}
          step={1}
          value={expSlider}
          onChange={(e) => handleExpChange(Number(e.target.value))}
          className="flex-1 h-1 accent-dwarf-accent bg-white/10 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-dwarf-accent"
        />
        <span className="text-[10px] text-white/40 w-12 text-right tabular-nums">{currentExpLabel}</span>
      </div>

      {/* Other sliders grid — 2 columns */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {PARAMS.map((param) => (
          <div key={param.key} className="flex items-center gap-2">
            <span className="text-[10px] text-white/50 w-7 flex-shrink-0">{param.label}</span>
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={values[param.key]}
              onChange={(e) => handleChange(param, Number(e.target.value))}
              className="flex-1 h-1 accent-dwarf-accent bg-white/10 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-dwarf-accent"
            />
            <span className="text-[10px] text-white/40 w-8 text-right tabular-nums">{values[param.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
