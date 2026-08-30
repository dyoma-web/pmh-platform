// Reglas de formato del manual Koleto §16:
// 27 ago 2026 · $ 4.185.598 COP · miles con punto, decimales con coma · nunca «COP$».
const nf0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const cop = (v) => (v == null ? "—" : "$ " + nf0.format(Number(v)));
export const n0 = (v) => (v == null ? "—" : nf0.format(Number(v)));
export const n1 = (v) => (v == null ? "—" : nf1.format(Number(v)));
export const mcop = (v) => (v == null ? "—" : nf0.format(Math.round(Number(v) / 1e6)));

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fecha(d) {
  if (!d) return "—";
  const x = new Date(d);
  return `${x.getDate()} ${MES[x.getMonth()]} ${x.getFullYear()}`;
}
export function fechaHora(d) {
  if (!d) return "—";
  const x = new Date(d);
  const hh = String(x.getHours()).padStart(2, "0");
  const mm = String(x.getMinutes()).padStart(2, "0");
  return `${fecha(d)} · ${hh}:${mm}`;
}
export const hoy = () => {
  const x = new Date();
  const DIA = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
  return `${DIA[x.getDay()]} ${fecha(x).toUpperCase()}`;
};
