// Globals the page gets from outside the bundle: the Telegram Mini App script and MapLibre (loaded on demand).

interface Window {
  Telegram?: { WebApp?: any };
  maplibregl?: any;
}

/** A plain object with open keys: the app's stores and option bags until they get real types. */
type Bag = { [key: string]: any };

// Loose phase: entries/values of an untyped object give `any`, not `unknown` (remove once the stores have real types).
interface ObjectConstructor {
  entries(o: any): [string, any][];
  values(o: any): any[];
  fromEntries(entries: Iterable<readonly any[]>): any;
}
