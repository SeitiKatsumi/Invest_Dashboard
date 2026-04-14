import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import investLogo from "@assets/Icon_Invest_1769010072868.jpg";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Bot,
  MessageSquare,
  Plus,
  Copy,
  Brain,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Archive,
  Brush,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scraping", label: "AI Scraping", icon: Bot },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageSquare },
  { href: "/cadastro", label: "Cadastrar Leilão", icon: Plus },
  { href: "/duplicatas", label: "Duplicatas", icon: Copy },
  { href: "/classificador", label: "Classificador IA", icon: Brain },
  { href: "/arquivamento", label: "Arquivamento", icon: Archive },
  { href: "/limpeza", label: "Limpeza Seletiva", icon: Brush },
  { href: "/logs", label: "Logs Detalhados", icon: FileText },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export function Sidebar({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  return (
    <div className="min-h-screen bg-background flex">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          data-testid="sidebar-overlay"
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full bg-card border-r flex flex-col transition-all duration-300 ease-in-out",
          collapsed ? "w-[68px]" : "w-[240px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        data-testid="sidebar"
      >
        <div className={cn(
          "flex items-center gap-3 p-4 border-b min-h-[64px]",
          collapsed && "justify-center px-2"
        )}>
          <img
            src={investLogo}
            alt="Invest Leilões"
            className="h-9 w-9 rounded-lg object-contain shrink-0"
          />
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold leading-tight truncate">Invest Leilões</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Monitoramento</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <button
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    collapsed && "justify-center px-2"
                  )}
                  title={collapsed ? item.label : undefined}
                  data-testid={`nav-${item.href.replace("/", "") || "dashboard"}`}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              </Link>
            );
          })}
        </nav>

        <div className={cn(
          "border-t p-3 flex items-center",
          collapsed ? "justify-center" : "justify-between"
        )}>
          {!collapsed && <ThemeToggle />}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="button-toggle-sidebar"
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          {collapsed && <span />}
        </div>
      </aside>

      <div
        className={cn(
          "flex-1 min-w-0 transition-all duration-300 ease-in-out",
          collapsed ? "lg:ml-[68px]" : "lg:ml-[240px]"
        )}
      >
        <div className="lg:hidden sticky top-0 z-30 bg-card border-b px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileOpen(true)}
            data-testid="button-mobile-menu"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
          <img src={investLogo} alt="Invest Leilões" className="h-7 w-7 rounded-md object-contain" />
          <span className="text-sm font-semibold">Invest Leilões</span>
        </div>
        {children}
      </div>
    </div>
  );
}
