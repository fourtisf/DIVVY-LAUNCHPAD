import { hashStr, mulberry32 } from "./random";

/**
 * Deterministic placeholder coin picture (prototype `avatar`). Used for the create-page preview before
 * an image is uploaded, and by the mock API for demo coins. Returns an SVG document string.
 */
export function avatarSvg(seed: string): string {
  const r = mulberry32(hashStr(seed));
  const h = Math.floor(r() * 360),
    h2 = (h + 140 + r() * 80) % 360;
  const ink = "#10241A",
    shape = Math.floor(r() * 4),
    dx = 9 + r() * 7,
    er = 5.5 + r() * 3.5,
    mouth = Math.floor(r() * 4),
    hat = r() < 0.3,
    blush = r() < 0.6;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 75% 74%)"/><stop offset="1" stop-color="hsl(${(h + 35) % 360} 62% 52%)"/></linearGradient><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h2} 62% 56%)"/><stop offset="1" stop-color="hsl(${h2} 66% 38%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#b)"/>`;
  if (shape === 0) s += `<circle cx="50" cy="64" r="34" fill="url(#f)"/><ellipse cx="38" cy="46" rx="11" ry="6" fill="#fff" opacity=".18"/>`;
  else if (shape === 1) s += `<rect x="17" y="32" width="66" height="66" rx="26" fill="url(#f)"/><ellipse cx="36" cy="44" rx="11" ry="5" fill="#fff" opacity=".18"/>`;
  else if (shape === 2) s += `<path d="M50 20 Q54 20 57 26 L90 92 Q92 98 86 98 L14 98 Q8 98 10 92 L43 26 Q46 20 50 20Z" fill="url(#f)"/>`;
  else
    s += `<circle cx="29" cy="42" r="12" fill="url(#f)"/><circle cx="71" cy="42" r="12" fill="url(#f)"/><ellipse cx="50" cy="68" rx="40" ry="31" fill="url(#f)"/><ellipse cx="36" cy="52" rx="11" ry="5" fill="#fff" opacity=".18"/>`;
  const ey = shape === 2 ? 66 : 60;
  s += `<circle cx="${50 - dx}" cy="${ey}" r="${er}" fill="#fff"/><circle cx="${50 + dx}" cy="${ey}" r="${er}" fill="#fff"/>`;
  s += `<circle cx="${50 - dx + er * 0.25}" cy="${ey + er * 0.15}" r="${er * 0.55}" fill="${ink}"/><circle cx="${50 + dx + er * 0.25}" cy="${ey + er * 0.15}" r="${er * 0.55}" fill="${ink}"/>`;
  s += `<circle cx="${50 - dx + er * 0.45}" cy="${ey - er * 0.2}" r="${er * 0.2}" fill="#fff"/><circle cx="${50 + dx + er * 0.45}" cy="${ey - er * 0.2}" r="${er * 0.2}" fill="#fff"/>`;
  if (blush)
    s += `<ellipse cx="${50 - dx - 4}" cy="${ey + 11}" rx="5" ry="3" fill="#FF8FB1" opacity=".55"/><ellipse cx="${50 + dx + 4}" cy="${ey + 11}" rx="5" ry="3" fill="#FF8FB1" opacity=".55"/>`;
  const my = ey + 14;
  if (mouth === 0) s += `<path d="M43 ${my} Q50 ${my + 7} 57 ${my}" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else if (mouth === 1) s += `<path d="M44 ${my + 2} H56" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  else if (mouth === 2) s += `<ellipse cx="50" cy="${my + 2}" rx="3.5" ry="4.5" fill="${ink}"/>`;
  else s += `<path d="M43 ${my + 4} Q50 ${my - 3} 57 ${my + 4}" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (hat) {
    const hy = shape === 2 ? 14 : shape === 3 ? 20 : 22;
    s += `<rect x="31" y="${hy + 10}" width="38" height="8" rx="4" fill="${ink}"/><rect x="38" y="${hy - 4}" width="24" height="16" rx="4" fill="${ink}"/><rect x="38" y="${hy + 6}" width="24" height="3" fill="#4ADE80"/>`;
  }
  return s + "</svg>";
}

export const avatarDataUri = (seed: string): string => "data:image/svg+xml;utf8," + encodeURIComponent(avatarSvg(seed));
