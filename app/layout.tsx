import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Hotel Corali PMS",
  description: "Secure property management and direct booking system for Hotel Corali",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}
