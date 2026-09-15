// Camera/library photo picking + the mandatory downscale, behind one
// shared hidden input (the UX demo's pattern — one input, re-targeted per
// pick; resetting `value` lets the same file fire `change` again).
//
// Flow: pick() → hidden <input type="file" accept="image/*"
// capture="environment"> → lib/image.ts downscaleToJpeg (1600 px, q0.82,
// EXIF-corrected) → either the `onBlob` callback (pickPhotoBlob — the
// change-photo flow uploads immediately) or the hook's `picked` state with
// an object-URL preview (add-plant form, water sheet).

import { useCallback, useEffect, useRef, useState } from "react";
import { downscaleToJpeg } from "../lib/image";

let sharedInput: HTMLInputElement | null = null;

function getInput(): HTMLInputElement {
  if (!sharedInput) {
    sharedInput = document.createElement("input");
    sharedInput.type = "file";
    sharedInput.accept = "image/*";
    // Phones open the rear camera directly; desktops fall back to a picker.
    sharedInput.setAttribute("capture", "environment");
    sharedInput.style.display = "none";
    document.body.appendChild(sharedInput);
  }
  return sharedInput;
}

/** One-shot pick → downscale → callback. Must be called from a user
 *  gesture (the programmatic click is gated otherwise). A cancelled picker
 *  simply never calls back. */
export function pickPhotoBlob(
  onBlob: (blob: Blob) => void,
  onError: (e: unknown) => void,
): void {
  const input = getInput();
  input.value = "";
  input.onchange = () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    downscaleToJpeg(file).then(onBlob).catch(onError);
  };
  input.click();
}

export interface PickedPhoto {
  /** Downscaled JPEG, ready for lib/blob.ts. */
  blob: Blob;
  /** Object URL for the form preview — revoked on replace/clear/unmount. */
  previewUrl: string;
}

export function usePhotoPicker(onError: (e: unknown) => void): {
  picked: PickedPhoto | null;
  pick: () => void;
  clear: () => void;
} {
  const [picked, setPicked] = useState<PickedPhoto | null>(null);

  // Track the live value for the unmount revoke (state isn't readable there).
  const pickedRef = useRef<PickedPhoto | null>(null);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  useEffect(
    () => () => {
      if (pickedRef.current) URL.revokeObjectURL(pickedRef.current.previewUrl);
    },
    [],
  );

  const pick = useCallback(() => {
    pickPhotoBlob((blob) => {
      setPicked((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { blob, previewUrl: URL.createObjectURL(blob) };
      });
    }, onError);
  }, [onError]);

  const clear = useCallback(() => {
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  return { picked, pick, clear };
}
