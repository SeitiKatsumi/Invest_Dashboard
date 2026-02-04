import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "wouter";
import { ArrowLeft, Save, Loader2, Search, Building2, MapPin, FileText, DollarSign, Calendar, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Site, leilaoInsertSchema, LeilaoInsert } from "@shared/schema";
import { ThemeToggle } from "@/components/theme-toggle";

interface ViaCepResponse {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}

export default function CadastroPage() {
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Cadastro de Leilão | Painel Invest Leilões";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Cadastre manualmente imóveis de leilão no sistema de monitoramento Invest Leilões Brasil.");
    }
  }, []);

  const { data: sites = [], isLoading: sitesLoading } = useQuery<Site[]>({
    queryKey: ["/api/sites"],
  });

  const form = useForm<LeilaoInsert>({
    resolver: zodResolver(leilaoInsertSchema),
    defaultValues: {
      site: 0,
      nome_do_anuncio: "",
      descricao: "",
      area_imovel: "",
      tipo_do_imovel: "",
      tipo_de_leilao: "",
      nome_leiloeiro: "",
      valor_avalaiacao_imovel: "",
      valor_leilao: "",
      valor_praca1: "",
      valor_praca2: "",
      valor_praca3: "",
      praca_1: "",
      praca_2: "",
      praca_3: "",
      link_edital: "",
      link_matricula: "",
      link_anuncio: "",
      link_imagem: "",
      desconto: "",
      numero_do_processo: "",
      cep: "",
      cidade: "",
      estado_uf: "",
      logradouro: "",
      bairro: "",
      numero: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: LeilaoInsert) => {
      const response = await apiRequest("POST", "/api/leiloes", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Leilão cadastrado com sucesso!",
        description: "O imóvel foi adicionado ao sistema.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao cadastrar leilão",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const searchCep = async () => {
    const cep = form.getValues("cep")?.replace(/\D/g, "");
    if (!cep || cep.length !== 8) {
      toast({
        title: "CEP inválido",
        description: "Digite um CEP com 8 dígitos",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data: ViaCepResponse = await response.json();

      if (data.erro) {
        toast({
          title: "CEP não encontrado",
          description: "Verifique o CEP informado",
          variant: "destructive",
        });
        return;
      }

      form.setValue("logradouro", data.logradouro || "");
      form.setValue("bairro", data.bairro || "");
      form.setValue("cidade", data.localidade || "");
      form.setValue("estado_uf", data.uf || "");

      toast({
        title: "Endereço encontrado",
        description: `${data.logradouro}, ${data.bairro} - ${data.localidade}/${data.uf}`,
      });
    } catch {
      toast({
        title: "Erro ao buscar CEP",
        description: "Não foi possível consultar o CEP",
        variant: "destructive",
      });
    }
  };

  const onSubmit = (data: LeilaoInsert) => {
    createMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-dashboard">
                <ArrowLeft className="h-4 w-4" />
                Voltar ao Dashboard
              </Button>
            </Link>
            <h1 className="text-xl font-semibold">Cadastro Manual de Leilão</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Informações Básicas
                </CardTitle>
                <CardDescription>Dados principais do imóvel em leilão</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="site"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Site de Origem *</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        value={field.value ? String(field.value) : undefined}
                        disabled={sitesLoading}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-site">
                            <SelectValue placeholder="Selecione o site de origem" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sites.map((site) => (
                            <SelectItem key={site.id} value={String(site.id)}>
                              {site.nome_site || `Site #${site.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="nome_do_anuncio"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Nome do Anúncio</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Apartamento 3 quartos centro" {...field} data-testid="input-nome-anuncio" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="descricao"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Descreva o imóvel..." className="min-h-[100px]" {...field} data-testid="input-descricao" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tipo_do_imovel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo do Imóvel</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tipo-imovel">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Casa">Casa</SelectItem>
                          <SelectItem value="Apartamento">Apartamento</SelectItem>
                          <SelectItem value="Terreno">Terreno</SelectItem>
                          <SelectItem value="Comercial">Comercial</SelectItem>
                          <SelectItem value="Rural">Rural</SelectItem>
                          <SelectItem value="Outros">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="area_imovel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Área do Imóvel</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 120m²" {...field} data-testid="input-area" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tipo_de_leilao"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Leilão</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Judicial, Extrajudicial" {...field} data-testid="input-tipo-leilao" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="nome_leiloeiro"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do Leiloeiro</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do leiloeiro responsável" {...field} data-testid="input-leiloeiro" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="numero_do_processo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número do Processo</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 0001234-56.2024.8.26.0000" {...field} data-testid="input-processo" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  Valores
                </CardTitle>
                <CardDescription>Valores de avaliação e leilão</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="valor_avalaiacao_imovel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor de Avaliação</FormLabel>
                      <FormControl>
                        <Input placeholder="R$ 0,00" {...field} data-testid="input-valor-avaliacao" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="valor_leilao"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor do Leilão</FormLabel>
                      <FormControl>
                        <Input placeholder="R$ 0,00" {...field} data-testid="input-valor-leilao" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="valor_praca1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor 1ª Praça</FormLabel>
                      <FormControl>
                        <Input placeholder="R$ 0,00" {...field} data-testid="input-valor-praca1" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="valor_praca2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor 2ª Praça</FormLabel>
                      <FormControl>
                        <Input placeholder="R$ 0,00" {...field} data-testid="input-valor-praca2" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="valor_praca3"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor 3ª Praça</FormLabel>
                      <FormControl>
                        <Input placeholder="R$ 0,00" {...field} data-testid="input-valor-praca3" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="desconto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Desconto</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 30%" {...field} data-testid="input-desconto" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-orange-600" />
                  Datas das Praças
                </CardTitle>
                <CardDescription>Datas de realização das praças</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="praca_1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>1ª Praça</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-praca1" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="praca_2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>2ª Praça</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-praca2" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="praca_3"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>3ª Praça</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-praca3" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-red-600" />
                  Endereço
                </CardTitle>
                <CardDescription>Localização do imóvel</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="cep"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CEP</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input placeholder="00000-000" {...field} data-testid="input-cep" />
                        </FormControl>
                        <Button type="button" variant="secondary" size="icon" onClick={searchCep} data-testid="button-search-cep">
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="estado_uf"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estado (UF)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: SP" {...field} data-testid="input-uf" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cidade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cidade</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome da cidade" {...field} data-testid="input-cidade" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bairro"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bairro</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do bairro" {...field} data-testid="input-bairro" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="logradouro"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Logradouro</FormLabel>
                      <FormControl>
                        <Input placeholder="Rua, Avenida, etc" {...field} data-testid="input-logradouro" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="numero"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número</FormLabel>
                      <FormControl>
                        <Input placeholder="Número" {...field} data-testid="input-numero" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-blue-600" />
                  Links e Documentos
                </CardTitle>
                <CardDescription>Links para documentos e anúncio</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4">
                <FormField
                  control={form.control}
                  name="link_anuncio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Link do Anúncio</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} data-testid="input-link-anuncio" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="link_imagem"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Link da Imagem</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} data-testid="input-link-imagem" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="link_edital"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Link do Edital</FormLabel>
                        <FormControl>
                          <Input placeholder="https://..." {...field} data-testid="input-link-edital" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="link_matricula"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Link da Matrícula</FormLabel>
                        <FormControl>
                          <Input placeholder="https://..." {...field} data-testid="input-link-matricula" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4">
              <Link href="/">
                <Button type="button" variant="outline" data-testid="button-cancel">
                  Cancelar
                </Button>
              </Link>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit">
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Cadastrar Leilão
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </main>
    </div>
  );
}
