// Cabecera narrativa: cada pantalla abre con una tesis calculada de los datos
// (qué pasa · por qué importa · qué hacer), no con un título de módulo.
export default function Historia({ num, seccion, titulo, lede, lado }) {
  return (
    <header className="historia">
      <div className="eyebrow2">
        <span className="tick" aria-hidden="true" />
        <span>
          {num} · {seccion}
        </span>
      </div>
      <div className="fila-titulo">
        <h1>{titulo}</h1>
        {lado && <div className="lado">{lado}</div>}
      </div>
      {lede && <p className="lede">{lede}</p>}
    </header>
  );
}
