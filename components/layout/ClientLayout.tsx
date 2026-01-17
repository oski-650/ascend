"use client";
import ScrollTop from "@/components/scroll/ScrollTop";
import MobileMenu from "@/components/headers/MobileMenu";
import Header1 from "@/components/headers/Header1";
import InitScroll from "@/components/scroll/InitScroll";
import LenisSmoothScroll from "@/components/scroll/LenisSmoothScroll";
import ScrollToTop from "@/components/common/ScrollToTop";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  return (
    <>
      <ScrollToTop />
      <MobileMenu />
      <Header1 />
      {children}
      <ScrollTop />
      <InitScroll />
      <LenisSmoothScroll />
    </>
  );
}
