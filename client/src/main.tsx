import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { Toaster } from "sonner";
import Prestow from "@/pages/Prestow";
import "./index.css";

function PublicShell({ children }: { children: ReactNode }) {
  return <>
    <header className="appheader demo-header">
      <div className="demo-wrap bar"><strong>多票货预配载 · 公开演示版</strong></div>
    </header>
    <main style={{ flex: 1 }}><div className="demo-scale">{children}</div></main>
    <footer className="demo-footer"><div className="demo-wrap">虚构船 · 演示 · 未认证 · 不得用于实际作业</div></footer>
    <Toaster />
  </>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Router><PublicShell><Prestow /></PublicShell></Router></StrictMode>,
);
