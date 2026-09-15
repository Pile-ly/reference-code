// Initials-on-a-color avatar for commenters/bylines. The color is derived
// deterministically from the handle so the same person is always the same
// color — no avatar storage anywhere.

const PALETTE = ["#4a6fa5", "#5a8a5a", "#a5684a", "#7a5aa5", "#a55a7a", "#5a8a9e"];

function colorFor(handle: string): string {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function Avatar({ handle, size = 34 }: { handle: string; size?: number }) {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(handle), fontSize: size * 0.35 }}
    >
      {handle.slice(0, 2).toUpperCase()}
    </div>
  );
}
