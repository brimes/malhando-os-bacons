import { useRef, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { compressImage } from '../lib/imageCompress';
import { getErrorMessage } from '../api/client';
import { Button } from './Button';
import { CameraIcon } from './nutricao/icons';

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
    <div className="space-y-3">
      {/* Visor: moldura com cantos, só decoração; o toque é no botão abaixo. */}
      <div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-xl bg-surface px-6 text-center shadow-card tint-teal">
        {[ 'left-4 top-4 border-l-4 border-t-4 rounded-tl-lg', 'right-4 top-4 border-r-4 border-t-4 rounded-tr-lg', 'bottom-4 left-4 border-b-4 border-l-4 rounded-bl-lg', 'bottom-4 right-4 border-b-4 border-r-4 rounded-br-lg' ].map((c) => (
          <span key={c} className={`absolute h-8 w-8 border-teal ${c}`} aria-hidden="true" />
        ))}
        <CameraIcon className="h-12 w-12 text-teal" />
        {hint && <p className="max-w-[240px] text-[15px] leading-[1.45] text-muted">{hint}</p>}
      </div>
      <Button size="lg" fullWidth disabled={disabled || isCapturing} onClick={capture}>
        <CameraIcon className="h-6 w-6" /> {isCapturing ? 'Processando' : label}
      </Button>
      <Button size="md" variant="ghost" fullWidth disabled={disabled || isCapturing} onClick={() => fileInputRef.current?.click()}>
        Ou escolher um arquivo
      </Button>
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileInput} />
      {error && <div role="alert" className="rounded-md bg-danger/15 p-3 text-[15px] text-danger">{error}</div>}
    </div>
  );
}
