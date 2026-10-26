/**
 * Official token icons in public/stocks, by symbol (fetched by mint with scripts/fetch-stock-logos.sh).
 * A symbol without one falls back to the prototype's initials.
 */
const HAVE = new Set(["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "GOOGLx", "AMZNx", "MSTRx", "COINx", "HOODx", "CRCLx", "SOL", "USDC"]);

export const stockLogo = (symbol: string): string | null => (HAVE.has(symbol) ? `/stocks/${symbol}.png` : null);
