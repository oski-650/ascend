import "../public/css/styles.css";
import ClientLayout from "@/components/layout/ClientLayout";
import { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";

// Self-hosted via next/font: preloaded, font-display: swap, and no
// render-blocking round trip to fonts.googleapis.com.
const funnelDisplay = Funnel_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-funnel-display",
});
const funnelSans = Funnel_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-funnel-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ascend-flame-zeta.vercel.app"),
  title: "Ascend Web Solutions - Web Design & Development",
  description:"Ascend Web Solutions creates websites and digital solutions that help businesses grow, convert, and scale online.",
};

const setColorSchemeScript = `
(function() {
  try {
    var scheme = localStorage.getItem('color-scheme') || 'light';
    document.documentElement.setAttribute('color-scheme', scheme);
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      suppressHydrationWarning
      lang="en"
      className={`no-touch ${funnelDisplay.variable} ${funnelSans.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: setColorSchemeScript }} />
      </head>
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}