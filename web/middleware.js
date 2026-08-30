import { NextResponse } from "next/server";

// Protección interina para F1 (Basic Auth). Se activa solo si BASIC_AUTH_USER y
// BASIC_AUTH_PASS existen en el entorno (en local sin variables no estorba).
// En F2 la reemplaza OIDC contra Google Workspace — esto nunca es el plan final.
export function middleware(req) {
  const { pathname } = req.nextUrl;
  // Los portales externos se autentican por token de registro, no por Basic Auth
  if (pathname.startsWith("/portal/") || pathname.startsWith("/cliente/") ||
      pathname.startsWith("/api/portal")) {
    return NextResponse.next();
  }
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get("authorization") || "";
  const esperado = "Basic " + btoa(`${user}:${pass}`);
  if (auth === esperado) return NextResponse.next();

  return new NextResponse("Cota requiere autenticación.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Cota", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
