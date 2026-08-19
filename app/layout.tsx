import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "NoRug Research Studio v0.6.6",
  description: "SaaS de investigación trazable con evidencias, aprobación humana y producción asistida por IA.",
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
