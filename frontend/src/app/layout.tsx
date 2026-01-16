import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StarknetProvider } from "../components/StarknetProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Zylith | Shielded CLMM",
  description: "Private Concentrated Liquidity AMM on Starknet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-black text-white`}>
        <StarknetProvider>
          {children}
        </StarknetProvider>
      </body>
    </html>
  );
}
