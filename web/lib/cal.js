// Aritmética de fechas sobre cadenas YYYY-MM-DD (sin zona horaria: la agenda
// trabaja en días civiles, y así los cálculos coinciden con to_char() de Postgres).
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MES3 = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const DIAS_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const parse = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
const fmtU = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => fmtU(new Date(parse(s).getTime() + n * 86400000));
export const lunes = (s) => addDays(s, -((parse(s).getUTCDay() + 6) % 7));
export const inicioMes = (s) => s.slice(0, 8) + "01";
export const finMes = (s) => fmtU(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)));
export const addMeses = (s, n) => {
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n;
  return fmtU(new Date(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1)));
};
export const esFinde = (s) => { const k = parse(s).getUTCDay(); return k === 0 || k === 6; };
export const diaSemana = (s) => DIAS_LARGO[parse(s).getUTCDay()];
export const diasHabiles = (a, b) => {
  let n = 0, d = a;
  while (d < b) { d = addDays(d, 1); if (!esFinde(d)) n++; }
  return n;
};
// Semanas (lunes→domingo) que cubren el mes de `s`
export const gridMes = (s) => {
  const fin = finMes(s);
  const semanas = [];
  let d = lunes(inicioMes(s));
  while (d <= fin) {
    const w = [];
    for (let i = 0; i < 7; i++) { w.push(d); d = addDays(d, 1); }
    semanas.push(w);
  }
  return semanas;
};
export const fechaCorta = (s) => `${+s.slice(8, 10)} ${MES3[+s.slice(5, 7) - 1]}`;
export const fechaLarga = (s) => `${+s.slice(8, 10)} de ${MESES[+s.slice(5, 7) - 1]} de ${s.slice(0, 4)}`;
