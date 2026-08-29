// TRM oficial (Superfinanciera vía datos.gov.co), cacheada 6 h en memoria.
// Si el servicio falla, se devuelve null y la interfaz la omite: nunca una cifra inventada.
let cache = { v: null, t: 0 };

export async function trmHoy() {
  if (cache.v && Date.now() - cache.t < 6 * 3600e3) return cache.v;
  try {
    const r = await fetch(
      "https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC",
      { next: { revalidate: 21600 } }
    );
    if (!r.ok) return cache.v;
    const j = await r.json();
    const v = Number(j?.[0]?.valor);
    if (v > 0) cache = { v, t: Date.now() };
    return cache.v;
  } catch {
    return cache.v;
  }
}
