import { useRef, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { compressImage } from '../lib/imageCompress';
import { getErrorMessage } from '../api/client';

interface FoodPhotoCaptureProps {
  label: string;
  hint?: string;
  onCapture: (file: Blob) => void;
  disabled?: boolean;
}

/**
 * Capacitor's Camera plugin works both natively (real camera/gallery picker)
 * and in a plain browser (it falls back to a file input there), so this is
 * the only capture path — no separate web-only branch to keep in sync. A
 * plain <input type="file"> underneath is a manual escape hatch for browsers
 * where that fallback misbehaves.
 */
export function FoodPhotoCapture({ label, hint, onCapture, disabled }: FoodPhotoCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const capture = async () => {
    setError(null);
    setIsCapturing(true);
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        promptLabelHeader: label,
        promptLabelPhoto: 'Escolher da galeria',
        promptLabelPicture: 'Tirar foto',
      });
      if (!photo.webPath) throw new Error('Não foi possível capturar a foto');
      const response = await fetch(photo.webPath);
      const raw = await response.blob();
      onCapture(await compressImage(raw));
    } catch (requestError) {
      // The plugin throws when the person just cancels the picker — that is
      // not an error worth showing.
      const message = getErrorMessage(requestError);
      if (!/cancel/i.test(message)) setError(message);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setIsCapturing(true);
    try {
      onCapture(await compressImage(file));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || isCapturing}
        onClick={capture}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900 px-4 py-8 text-center disabled:opacity-50"
      >
        <span className="text-3xl">📷</span>
        <span className="text-sm font-semibold text-white">{isCapturing ? 'Processando...' : label}</span>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </button>

      <button
        type="button"
        disabled={disabled || isCapturing}
        onClick={() => fileInputRef.current?.click()}
        className="w-full text-center text-xs text-zinc-500 underline disabled:opacity-50"
      >
        Ou escolher um arquivo
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />

      {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
    </div>
  );
}
