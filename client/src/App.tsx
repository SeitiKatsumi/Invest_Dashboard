import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { Sidebar } from "@/components/sidebar";
import Dashboard from "@/pages/dashboard";
import LogsPage from "@/pages/logs";
import CadastroPage from "@/pages/cadastro";
import ScrapingPage from "@/pages/scraping";
import WhatsAppPage from "@/pages/whatsapp";
import SettingsPage from "@/pages/settings";
import DuplicatasPage from "@/pages/duplicatas";
import ClassificadorPage from "@/pages/classificador";
import ArquivamentoPage from "@/pages/arquivamento";
import LimpezaPage from "@/pages/limpeza";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Sidebar>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/logs" component={LogsPage} />
        <Route path="/cadastro" component={CadastroPage} />
        <Route path="/scraping" component={ScrapingPage} />
        <Route path="/whatsapp" component={WhatsAppPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/duplicatas" component={DuplicatasPage} />
        <Route path="/classificador" component={ClassificadorPage} />
        <Route path="/arquivamento" component={ArquivamentoPage} />
        <Route path="/limpeza" component={LimpezaPage} />
        <Route component={NotFound} />
      </Switch>
    </Sidebar>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="dashboard-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
