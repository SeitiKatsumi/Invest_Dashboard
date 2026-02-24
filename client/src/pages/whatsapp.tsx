import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { WhatsAppGrupo, WhatsAppDisparo, Leilao } from "@shared/schema";
import { Link } from "wouter";
import { ThemeToggle } from "@/components/theme-toggle";
import investLogo from "@assets/Icon_Invest_1769010072868.jpg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MessageSquare,
  Wifi,
  WifiOff,
  QrCode,
  Plus,
  Trash2,
  Edit,
  Send,
  Search,
  RefreshCw,
  LayoutDashboard,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Phone,
  MapPin,
  Users,
  History,
  ArrowLeft,
  Download,
  Link as LinkIcon,
  ChevronDown,
  ChevronRight,
  Network,
} from "lucide-react";

function ConnectionPanel() {
  const { toast } = useToast();

  const { data: status, refetch: refetchStatus } = useQuery<{
    status: string;
    phone: string | null;
    hasQR: boolean;
  }>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: 3000,
  });

  const { data: qrData, refetch: refetchQR } = useQuery<{
    qr: string | null;
    status: string;
  }>({
    queryKey: ["/api/whatsapp/qr"],
    refetchInterval: status?.status === "connecting" ? 2000 : false,
    enabled: status?.status !== "connected",
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/connect"),
    onSuccess: () => {
      refetchStatus();
      refetchQR();
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao conectar", description: error.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/disconnect"),
    onSuccess: () => {
      refetchStatus();
      toast({ title: "Desconectado", description: "WhatsApp foi desconectado" });
    },
  });

  const isConnected = status?.status === "connected";
  const isConnecting = status?.status === "connecting";
  const qrCode = qrData?.qr;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Conexão WhatsApp
        </CardTitle>
        <CardDescription>
          Conecte seu WhatsApp para enviar mensagens aos grupos
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${isConnected ? "bg-green-500" : isConnecting ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`} />
          <span className="font-medium" data-testid="text-wa-status">
            {isConnected ? "Conectado" : isConnecting ? "Conectando..." : "Desconectado"}
          </span>
          {isConnected && status?.phone && (
            <Badge variant="secondary" data-testid="text-wa-phone">{status.phone}</Badge>
          )}
        </div>

        {!isConnected && !isConnecting && (
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="gap-2"
            data-testid="button-wa-connect"
          >
            {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            Conectar WhatsApp
          </Button>
        )}

        {(isConnecting || qrCode) && !isConnected && (
          <div className="flex flex-col items-center gap-3 p-4 border rounded-lg bg-white dark:bg-gray-900">
            {qrCode ? (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  Escaneie o QR Code com seu WhatsApp
                </p>
                <img
                  src={qrCode}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64"
                  data-testid="img-qr-code"
                />
                <p className="text-xs text-muted-foreground text-center">
                  Abra o WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2 py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span>Gerando QR Code...</span>
              </div>
            )}
          </div>
        )}

        {isConnected && (
          <Button
            variant="destructive"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="gap-2"
            data-testid="button-wa-disconnect"
          >
            <WifiOff className="h-4 w-4" />
            Desconectar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function GruposPanel() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editGrupo, setEditGrupo] = useState<WhatsAppGrupo | null>(null);
  const [form, setForm] = useState({ nome: "", inviteLink: "", regiao: "", jid: "" });
  const [isResolvingLink, setIsResolvingLink] = useState(false);
  const [importSearch, setImportSearch] = useState("");
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [importRegiao, setImportRegiao] = useState("");

  const { data: status } = useQuery<{ status: string }>({
    queryKey: ["/api/whatsapp/status"],
  });

  const isConnected = status?.status === "connected";

  const { data: grupos, isLoading } = useQuery<WhatsAppGrupo[]>({
    queryKey: ["/api/whatsapp/grupos"],
  });

  type WAGroup = {
    id: string;
    subject: string;
    size: number;
    isCommunity: boolean;
    linkedParent?: string;
    linkedGroups?: { id: string; subject: string; size: number }[];
  };

  const { data: waGroups, isLoading: isLoadingWaGroups, refetch: refetchWaGroups } = useQuery<WAGroup[]>({
    queryKey: ["/api/whatsapp/my-groups"],
    enabled: false,
  });

  const [expandedCommunities, setExpandedCommunities] = useState<Set<string>>(new Set());

  const createMutation = useMutation({
    mutationFn: (data: { nome: string; jid: string; regiao: string }) =>
      apiRequest("POST", "/api/whatsapp/grupos", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/grupos"] });
      setShowDialog(false);
      setForm({ nome: "", inviteLink: "", regiao: "", jid: "" });
      toast({ title: "Grupo criado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WhatsAppGrupo> }) =>
      apiRequest("PATCH", `/api/whatsapp/grupos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/grupos"] });
      setShowDialog(false);
      setEditGrupo(null);
      setForm({ nome: "", inviteLink: "", regiao: "", jid: "" });
      toast({ title: "Grupo atualizado" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/whatsapp/grupos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/grupos"] });
      toast({ title: "Grupo removido" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      apiRequest("PATCH", `/api/whatsapp/grupos/${id}`, { ativo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/grupos"] });
    },
  });

  const openCreate = () => {
    setEditGrupo(null);
    setForm({ nome: "", inviteLink: "", regiao: "", jid: "" });
    setShowDialog(true);
  };

  const openEdit = (g: WhatsAppGrupo) => {
    setEditGrupo(g);
    setForm({ nome: g.nome, inviteLink: "", regiao: g.regiao || "", jid: g.jid });
    setShowDialog(true);
  };

  const resolveLink = async () => {
    if (!form.inviteLink) return;
    setIsResolvingLink(true);
    try {
      const resp = await apiRequest("POST", "/api/whatsapp/resolve-invite", { link: form.inviteLink });
      const data = await resp.json();
      setForm((prev) => ({
        ...prev,
        jid: data.jid,
        nome: prev.nome || data.subject,
      }));
      toast({ title: "Link resolvido!", description: `Grupo: ${data.subject}` });
    } catch (error) {
      toast({
        title: "Erro ao resolver link",
        description: error instanceof Error ? error.message : "Verifique o link e tente novamente",
        variant: "destructive",
      });
    } finally {
      setIsResolvingLink(false);
    }
  };

  const handleSubmit = () => {
    if (!form.nome || !form.jid) {
      toast({ title: "Preencha o Nome e resolva o link ou informe o JID", variant: "destructive" });
      return;
    }
    if (editGrupo) {
      updateMutation.mutate({ id: editGrupo.id, data: { nome: form.nome, jid: form.jid, regiao: form.regiao } });
    } else {
      createMutation.mutate({ nome: form.nome, jid: form.jid, regiao: form.regiao });
    }
  };

  const openImport = () => {
    setSelectedImports(new Set());
    setImportSearch("");
    setImportRegiao("");
    refetchWaGroups();
    setShowImportDialog(true);
  };

  const toggleCommunityExpand = (id: string) => {
    setExpandedCommunities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleImport = (id: string) => {
    const group = (waGroups || []).find((g) => g.id === id);
    setSelectedImports((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (group?.isCommunity && group.linkedGroups) {
          group.linkedGroups.forEach((lg) => next.delete(lg.id));
        }
      } else {
        next.add(id);
        if (group?.isCommunity && group.linkedGroups) {
          group.linkedGroups.forEach((lg) => {
            if (!existingJids.has(lg.id)) next.add(lg.id);
          });
          setExpandedCommunities((prev) => new Set(prev).add(id));
        }
      }
      return next;
    });
  };

  const toggleLinkedGroupImport = (id: string) => {
    setSelectedImports((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelectedGroups = async () => {
    if (selectedImports.size === 0) return;
    const existingJidsSet = new Set(grupos?.map((g) => g.jid) || []);

    const allImportable: { id: string; subject: string }[] = [];
    for (const g of waGroups || []) {
      if (g.isCommunity && g.linkedGroups) {
        for (const lg of g.linkedGroups) {
          if (selectedImports.has(lg.id) && !existingJidsSet.has(lg.id)) {
            allImportable.push({ id: lg.id, subject: lg.subject });
          }
        }
      }
      if (!g.isCommunity && selectedImports.has(g.id) && !existingJidsSet.has(g.id)) {
        allImportable.push({ id: g.id, subject: g.subject });
      }
    }

    let created = 0;
    for (const g of allImportable) {
      try {
        await apiRequest("POST", "/api/whatsapp/grupos", {
          nome: g.subject,
          jid: g.id,
          regiao: importRegiao || null,
        });
        created++;
      } catch (e) {
        console.error("Error importing group:", e);
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/grupos"] });
    setShowImportDialog(false);
    toast({
      title: `${created} grupo${created !== 1 ? "s" : ""} importado${created !== 1 ? "s" : ""}`,
    });
  };

  const allGroupIds = new Set((waGroups || []).map((g) => g.id));
  const topLevelGroups = (waGroups || []).filter(
    (g) => !g.linkedParent || !allGroupIds.has(g.linkedParent)
  );
  const filteredWaGroups = topLevelGroups.filter((g) => {
    const search = importSearch.toLowerCase();
    if (g.subject.toLowerCase().includes(search)) return true;
    if (g.isCommunity && g.linkedGroups) {
      return g.linkedGroups.some((lg) => lg.subject.toLowerCase().includes(search));
    }
    return false;
  });

  const existingJids = new Set(grupos?.map((g) => g.jid) || []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Grupos de Disparo
            </CardTitle>
            <CardDescription>
              Cadastre os grupos do WhatsApp organizados por região
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <Button variant="outline" onClick={openImport} className="gap-2" data-testid="button-import-grupos">
                <Download className="h-4 w-4" />
                Importar Meus Grupos
              </Button>
            )}
            <Button onClick={openCreate} className="gap-2" data-testid="button-add-grupo">
              <Plus className="h-4 w-4" />
              Novo Grupo
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !grupos || grupos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Nenhum grupo cadastrado</p>
            <p className="text-sm">
              {isConnected
                ? 'Use "Importar Meus Grupos" ou adicione manualmente'
                : "Conecte o WhatsApp e importe seus grupos, ou adicione manualmente"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>JID</TableHead>
                <TableHead>Região</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.map((g) => (
                <TableRow key={g.id} data-testid={`row-grupo-${g.id}`}>
                  <TableCell className="font-medium">{g.nome}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate">{g.jid}</TableCell>
                  <TableCell>
                    {g.regiao ? (
                      <Badge variant="outline" className="gap-1">
                        <MapPin className="h-3 w-3" />
                        {g.regiao}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={g.ativo}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: g.id, ativo: !!checked })
                      }
                      data-testid={`checkbox-grupo-ativo-${g.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(g)}
                        data-testid={`button-edit-grupo-${g.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Remover este grupo?")) {
                            deleteMutation.mutate(g.id);
                          }
                        }}
                        data-testid={`button-delete-grupo-${g.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editGrupo ? "Editar Grupo" : "Novo Grupo"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="grupo-nome">Nome do Grupo *</Label>
                <Input
                  id="grupo-nome"
                  placeholder="Ex: Grupo SP Capital"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  data-testid="input-grupo-nome"
                />
              </div>

              {!editGrupo && isConnected && (
                <div className="space-y-2">
                  <Label htmlFor="grupo-invite">Link de Convite do Grupo</Label>
                  <div className="flex gap-2">
                    <Input
                      id="grupo-invite"
                      placeholder="https://chat.whatsapp.com/AbCdEfGh..."
                      value={form.inviteLink}
                      onChange={(e) => setForm({ ...form, inviteLink: e.target.value })}
                      data-testid="input-grupo-invite"
                    />
                    <Button
                      variant="outline"
                      onClick={resolveLink}
                      disabled={!form.inviteLink || isResolvingLink}
                      data-testid="button-resolve-link"
                    >
                      {isResolvingLink ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LinkIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cole o link de convite e clique no botão para preencher o JID automaticamente
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="grupo-jid">
                  JID do Grupo *
                  {form.jid && <span className="ml-2 text-green-600 text-xs font-normal">(preenchido)</span>}
                </Label>
                <Input
                  id="grupo-jid"
                  placeholder="Ex: 120363012345678@g.us"
                  value={form.jid}
                  onChange={(e) => setForm({ ...form, jid: e.target.value })}
                  data-testid="input-grupo-jid"
                  className={form.jid ? "border-green-300 bg-green-50 dark:bg-green-900/10" : ""}
                />
                <p className="text-xs text-muted-foreground">
                  {isConnected
                    ? "Preenchido automaticamente pelo link de convite, ou digite manualmente"
                    : "O JID é o identificador único do grupo (formato: números@g.us)"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="grupo-regiao">Região</Label>
                <Input
                  id="grupo-regiao"
                  placeholder="Ex: SP, RJ, Sul, Nacional"
                  value={form.regiao}
                  onChange={(e) => setForm({ ...form, regiao: e.target.value })}
                  data-testid="input-grupo-regiao"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-grupo"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                {editGrupo ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Importar Grupos do WhatsApp
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Buscar grupo por nome..."
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                  data-testid="input-import-search"
                />
                <Input
                  placeholder="Região (opcional)"
                  value={importRegiao}
                  onChange={(e) => setImportRegiao(e.target.value)}
                  className="w-40"
                  data-testid="input-import-regiao"
                />
              </div>

              {isLoadingWaGroups ? (
                <div className="flex items-center justify-center py-8 gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span>Buscando seus grupos...</span>
                </div>
              ) : filteredWaGroups.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhum grupo encontrado</p>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead className="text-right">Membros</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWaGroups.map((g) => {
                        if (g.isCommunity) {
                          const isExpanded = expandedCommunities.has(g.id);
                          const linkedGroups = g.linkedGroups || [];
                          const allLinkedSelected = linkedGroups.length > 0 && linkedGroups.every(
                            (lg) => selectedImports.has(lg.id) || existingJids.has(lg.id)
                          );
                          const someLinkedSelected = linkedGroups.some(
                            (lg) => selectedImports.has(lg.id)
                          );
                          return (
                            <Fragment key={g.id}>
                              <TableRow
                                className="cursor-pointer hover:bg-muted/50 bg-muted/20"
                                data-testid={`row-import-community-${g.id}`}
                              >
                                <TableCell>
                                  <Checkbox
                                    checked={allLinkedSelected}
                                    ref={(el) => {
                                      if (el) {
                                        (el as any).indeterminate = someLinkedSelected && !allLinkedSelected;
                                      }
                                    }}
                                    onCheckedChange={() => toggleImport(g.id)}
                                  />
                                </TableCell>
                                <TableCell
                                  className="font-semibold"
                                  onClick={() => toggleCommunityExpand(g.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <Network className="h-4 w-4 text-primary" />
                                    {g.subject}
                                    <Badge variant="outline" className="text-xs ml-1">
                                      Comunidade · {linkedGroups.length} grupo{linkedGroups.length !== 1 ? "s" : ""}
                                    </Badge>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">{g.size}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); toggleCommunityExpand(g.id); }}
                                    className="text-xs"
                                  >
                                    {isExpanded ? "Ocultar" : "Ver grupos"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                              {isExpanded && linkedGroups.map((lg) => {
                                const lgAlreadyAdded = existingJids.has(lg.id);
                                return (
                                  <TableRow
                                    key={lg.id}
                                    className={`${lgAlreadyAdded ? "opacity-50" : "cursor-pointer hover:bg-muted/50"}`}
                                    onClick={() => !lgAlreadyAdded && toggleLinkedGroupImport(lg.id)}
                                    data-testid={`row-import-linked-${lg.id}`}
                                  >
                                    <TableCell className="pl-6">
                                      <Checkbox
                                        checked={selectedImports.has(lg.id)}
                                        disabled={lgAlreadyAdded}
                                        onCheckedChange={() => !lgAlreadyAdded && toggleLinkedGroupImport(lg.id)}
                                      />
                                    </TableCell>
                                    <TableCell className="pl-12 text-sm">{lg.subject}</TableCell>
                                    <TableCell className="text-right text-muted-foreground text-sm">{lg.size}</TableCell>
                                    <TableCell className="text-right">
                                      {lgAlreadyAdded ? (
                                        <Badge variant="secondary" className="gap-1 text-xs">
                                          <CheckCircle2 className="h-3 w-3" />
                                          Já cadastrado
                                        </Badge>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">Disponível</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </Fragment>
                          );
                        }

                        const alreadyAdded = existingJids.has(g.id);
                        return (
                          <TableRow
                            key={g.id}
                            className={alreadyAdded ? "opacity-50" : "cursor-pointer hover:bg-muted/50"}
                            onClick={() => !alreadyAdded && toggleImport(g.id)}
                            data-testid={`row-import-grupo-${g.id}`}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedImports.has(g.id)}
                                disabled={alreadyAdded}
                                onCheckedChange={() => !alreadyAdded && toggleImport(g.id)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                {g.subject}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">{g.size}</TableCell>
                            <TableCell className="text-right">
                              {alreadyAdded ? (
                                <Badge variant="secondary" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Já cadastrado
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Disponível</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {filteredWaGroups.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedImports.size} grupo{selectedImports.size !== 1 ? "s" : ""} selecionado{selectedImports.size !== 1 ? "s" : ""}
                  {" | "}
                  {filteredWaGroups.length} grupo{filteredWaGroups.length !== 1 ? "s" : ""} encontrado{filteredWaGroups.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={importSelectedGroups}
                disabled={selectedImports.size === 0}
                className="gap-2"
                data-testid="button-confirm-import"
              >
                <Download className="h-4 w-4" />
                Importar {selectedImports.size} grupo{selectedImports.size !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function DisparoPanel() {
  const { toast } = useToast();
  const [leilaoId, setLeilaoId] = useState("");
  const [leilao, setLeilao] = useState<Leilao | null>(null);
  const [selectedGrupos, setSelectedGrupos] = useState<number[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [showMensagem, setShowMensagem] = useState(false);

  const { data: status } = useQuery<{ status: string }>({
    queryKey: ["/api/whatsapp/status"],
  });

  const { data: grupos } = useQuery<WhatsAppGrupo[]>({
    queryKey: ["/api/whatsapp/grupos"],
  });

  const activeGrupos = grupos?.filter((g) => g.ativo) || [];
  const isConnected = status?.status === "connected";

  const searchLeilao = async () => {
    const id = parseInt(leilaoId);
    if (!id || isNaN(id)) {
      toast({ title: "Digite um ID válido", variant: "destructive" });
      return;
    }
    setIsSearching(true);
    try {
      const resp = await fetch(`/api/whatsapp/leilao/${id}`);
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Leilão não encontrado");
      }
      const data = await resp.json();
      setLeilao(data);

      const previewResp = await fetch(`/api/whatsapp/preview/${id}`);
      if (previewResp.ok) {
        const previewData = await previewResp.json();
        setMensagem(previewData.mensagem);
        setShowMensagem(true);
      }
    } catch (error) {
      toast({
        title: "Leilão não encontrado",
        description: error instanceof Error ? error.message : "Verifique o ID",
        variant: "destructive",
      });
      setLeilao(null);
      setMensagem("");
      setShowMensagem(false);
    } finally {
      setIsSearching(false);
    }
  };

  const dispararMutation = useMutation({
    mutationFn: (data: { leilaoId: number; grupoIds: number[]; mensagem: string }) =>
      apiRequest("POST", "/api/whatsapp/disparar", data).then((r) => r.json()),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/disparos"] });
      toast({
        title: "Disparo realizado!",
        description: `${result.sent} enviados, ${result.failed} falharam`,
      });
      setSelectedGrupos([]);
    },
    onError: (error: Error) => {
      toast({
        title: "Erro no disparo",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDisparar = () => {
    if (!leilao) {
      toast({ title: "Busque um leilão primeiro", variant: "destructive" });
      return;
    }
    if (selectedGrupos.length === 0) {
      toast({ title: "Selecione ao menos um grupo", variant: "destructive" });
      return;
    }
    if (!mensagem.trim()) {
      toast({ title: "A mensagem não pode estar vazia", variant: "destructive" });
      return;
    }
    dispararMutation.mutate({ leilaoId: leilao.id, grupoIds: selectedGrupos, mensagem });
  };

  const resetMensagem = async () => {
    if (!leilao) return;
    try {
      const resp = await fetch(`/api/whatsapp/preview/${leilao.id}`);
      if (resp.ok) {
        const data = await resp.json();
        setMensagem(data.mensagem);
        toast({ title: "Template restaurado" });
      }
    } catch {
      toast({ title: "Erro ao restaurar template", variant: "destructive" });
    }
  };

  const toggleGrupo = (id: number) => {
    setSelectedGrupos((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedGrupos.length === activeGrupos.length) {
      setSelectedGrupos([]);
    } else {
      setSelectedGrupos(activeGrupos.map((g) => g.id));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Disparo de Leilão
        </CardTitle>
        <CardDescription>
          Busque um leilão pelo ID e envie para os grupos selecionados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isConnected && (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 rounded-lg text-sm">
            <WifiOff className="h-4 w-4 flex-shrink-0" />
            Conecte o WhatsApp primeiro para poder disparar mensagens
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="leilao-id" className="sr-only">ID do Leilão</Label>
            <Input
              id="leilao-id"
              placeholder="Digite o ID do leilão no Directus"
              value={leilaoId}
              onChange={(e) => setLeilaoId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchLeilao()}
              type="number"
              data-testid="input-leilao-id"
            />
          </div>
          <Button
            onClick={searchLeilao}
            disabled={isSearching}
            className="gap-2"
            data-testid="button-search-leilao"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>

        {leilao && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30" data-testid="card-leilao-preview">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold text-lg" data-testid="text-leilao-nome">
                  {leilao.nome_do_anuncio || `Leilão #${leilao.id}`}
                </h3>
                <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                  {leilao.tipo_do_imovel && <Badge variant="outline">{leilao.tipo_do_imovel}</Badge>}
                  {leilao.tipo_de_leilao && <Badge variant="outline">{leilao.tipo_de_leilao}</Badge>}
                  {leilao.estado_uf && (
                    <Badge variant="secondary" className="gap-1">
                      <MapPin className="h-3 w-3" />{leilao.estado_uf}
                    </Badge>
                  )}
                </div>
              </div>
              {(leilao as any).link_imagem && (
                <img
                  src={(leilao as any).link_imagem}
                  alt="Imagem do leilão"
                  className="w-24 h-24 rounded-lg object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {leilao.valor_avalaiacao_imovel && (
                <div>
                  <span className="text-muted-foreground">Avaliação:</span>{" "}
                  <strong>R$ {leilao.valor_avalaiacao_imovel}</strong>
                </div>
              )}
              {leilao.desconto && (
                <div>
                  <span className="text-muted-foreground">Desconto:</span>{" "}
                  <strong className="text-green-600">{leilao.desconto}</strong>
                </div>
              )}
              {leilao.cidade && (
                <div>
                  <span className="text-muted-foreground">Cidade:</span>{" "}
                  <strong>{leilao.cidade}</strong>
                </div>
              )}
              {leilao.praca_1 && (
                <div>
                  <span className="text-muted-foreground">1ª Praça:</span>{" "}
                  <strong>{leilao.praca_1}</strong>
                </div>
              )}
            </div>

            {leilao.descricao && (
              <p className="text-sm text-muted-foreground line-clamp-3">
                {leilao.descricao}
              </p>
            )}
          </div>
        )}

        {leilao && showMensagem && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Edit className="h-4 w-4" />
                Mensagem do Disparo
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetMensagem}
                className="gap-1 text-xs"
                data-testid="button-reset-template"
              >
                <RefreshCw className="h-3 w-3" />
                Restaurar original
              </Button>
            </div>
            <textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              className="w-full min-h-[300px] p-4 rounded-lg border bg-background font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="textarea-mensagem"
            />
            <p className="text-xs text-muted-foreground">
              Edite o texto acima livremente. Use *texto* para negrito no WhatsApp. Clique em "Restaurar original" para voltar ao template padrão.
            </p>
          </div>
        )}

        {leilao && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Selecione os grupos</Label>
              <Button variant="ghost" size="sm" onClick={selectAll} data-testid="button-select-all-grupos">
                {selectedGrupos.length === activeGrupos.length ? "Desmarcar todos" : "Selecionar todos"}
              </Button>
            </div>

            {activeGrupos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum grupo ativo cadastrado. Adicione grupos na seção acima.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeGrupos.map((g) => (
                  <div
                    key={g.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedGrupos.includes(g.id)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => toggleGrupo(g.id)}
                    data-testid={`card-select-grupo-${g.id}`}
                  >
                    <Checkbox
                      checked={selectedGrupos.includes(g.id)}
                      onCheckedChange={() => toggleGrupo(g.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{g.nome}</p>
                      {g.regiao && (
                        <p className="text-xs text-muted-foreground">{g.regiao}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button
              onClick={handleDisparar}
              disabled={
                !isConnected ||
                selectedGrupos.length === 0 ||
                dispararMutation.isPending
              }
              className="w-full gap-2"
              size="lg"
              data-testid="button-disparar"
            >
              {dispararMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              Disparar para {selectedGrupos.length} grupo{selectedGrupos.length !== 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoricoPanel() {
  const { data: disparos, isLoading } = useQuery<WhatsAppDisparo[]>({
    queryKey: ["/api/whatsapp/disparos"],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Histórico de Disparos
        </CardTitle>
        <CardDescription>
          Últimos disparos realizados
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !disparos || disparos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Nenhum disparo realizado</p>
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leilão</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disparos.map((d) => (
                  <TableRow key={d.id} data-testid={`row-disparo-${d.id}`}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {d.leilao_nome || `#${d.leilao_id}`}
                    </TableCell>
                    <TableCell>{d.grupo_nome || `#${d.grupo_id}`}</TableCell>
                    <TableCell>
                      {d.status === "enviado" ? (
                        <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Enviado
                        </Badge>
                      ) : d.status === "erro" ? (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" />
                          Erro
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Clock className="h-3 w-3" />
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {d.date_created
                        ? new Date(d.date_created).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function WhatsAppPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <img
              src={investLogo}
              alt="Invest Leilões"
              className="h-12 w-12 rounded-xl object-contain"
            />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
                <MessageSquare className="h-7 w-7 text-green-600" />
                Disparo WhatsApp
              </h1>
              <p className="text-sm text-muted-foreground">
                Envie leilões para os grupos da comunidade Invest
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="outline" className="gap-2" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <ConnectionPanel />
            <HistoricoPanel />
          </div>
          <div className="lg:col-span-2 space-y-6">
            <DisparoPanel />
            <GruposPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
