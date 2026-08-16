import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "NoRug Research Studio", description: "Investigación trazable y producción editorial asistida por IA." };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
