import { useEffect, useState } from 'react';
import { nutritionApi } from '../api/nutrition';

// A plain <img src> cannot carry the Authorization header the photo endpoint
// requires, so each photo is fetched once as an authenticated blob and kept
// as an object URL here. The cache is module-level and never revoked: a
// session only ever touches a handful of photos, so the memory this holds
// onto is negligible next to the complexity of reference-counting revokes
// across every place a thumbnail might render.
const urlCache = new Map<number, string>();

interface PhotoThumbProps {
  photoId: number;
  className?: string;
  alt?: string;
}

export function PhotoThumb({ photoId, className, alt = '' }: PhotoThumbProps) {
  const [url, setUrl] = useState<string | null>(() => urlCache.get(photoId) ?? null);

  useEffect(() => {
    if (urlCache.has(photoId)) {
      setUrl(urlCache.get(photoId)!);
      return;
    }
    let canceled = false;
    nutritionApi.photoObjectUrl(photoId).then((objectUrl) => {
      if (canceled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      urlCache.set(photoId, objectUrl);
      setUrl(objectUrl);
    }).catch(() => {
      if (!canceled) setUrl(null);
    });
    return () => {
      canceled = true;
    };
  }, [photoId]);

  if (!url) {
    return <div className={`animate-pulse bg-zinc-800 ${className ?? ''}`} />;
  }
  return <img src={url} alt={alt} className={className} />;
}
