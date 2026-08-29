"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/mi-dia", num: "00", label: "Mi día" },
  { href: "/", num: "01", label: "Cockpit" },
  { href: "/cartera", num: "03", label: "Cartera y cobro" },
  { href: "/calidad", num: "08", label: "Calidad de datos" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Secciones">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} aria-current={path === it.href ? "page" : undefined}>
          <span className="num">{it.num}</span>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
