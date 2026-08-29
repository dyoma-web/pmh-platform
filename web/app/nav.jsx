"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/mi-dia", num: "00", label: "Mi día" },
  { href: "/", num: "01", label: "Cockpit" },
  { href: "/proyectos", num: "02", label: "Proyectos" },
  { href: "/cartera", num: "03", label: "Cartera y cobro" },
  { href: "/contratacion", num: "04", label: "Contratación" },
  { href: "/catalogo", num: "05", label: "Catálogo IHPSC" },
  { href: "/infraestructura", num: "06", label: "Infraestructura" },
  { href: "/calidad", num: "08", label: "Calidad de datos" },
];

export default function Nav({ counts = {} }) {
  const path = usePathname();
  const activo = (href) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  return (
    <nav aria-label="Secciones">
      {ITEMS.map((it) => {
        const c = counts[it.href];
        return (
          <Link key={it.href} href={it.href} aria-current={activo(it.href) ? "page" : undefined}>
            <span className="num">{it.num}</span>
            {it.label}
            {c != null && Number(c) > 0 && (
              <span className={"cnt" + (["/cartera", "/proyectos"].includes(it.href) ? " critico" : "")}>
                {c}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
