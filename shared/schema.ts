import { z } from "zod";

export interface Site {
  id: number;
  status: string;
  nome_site: string | null;
  url_listagem: string | null;
  url_site: string | null;
  liga_desliga: string | null;
  date_created: string | null;
  date_updated: string | null;
}

export interface Leilao {
  id: number;
  status: string;
  nome_do_anuncio: string | null;
  descricao: string | null;
  area_imovel: string | null;
  tipo_do_imovel: string | null;
  tipo_de_leilao: string | null;
  nome_leiloeiro: string | null;
  valor_avalaiacao_imovel: string | null;
  praca_1: string | null;
  praca_2: string | null;
  praca_3: string | null;
  link_edital: string | null;
  link_matricula: string | null;
  desconto: string | null;
  estado_uf: string | null;
  cidade: string | null;
  endereco: string | null;
  arquivo_imagem: string | null;
  status_publicacao_wp: string | null;
  site: number | null;
  date_created: string | null;
  date_updated: string | null;
}

export interface LogScraping {
  id: number;
  status: string;
  site: number | Site | null;
  status_scraping: string | null;
  motivo_do_erro: string | null;
  date_created: string | null;
  date_updated: string | null;
}

export interface UrlConsulta {
  id: number;
  status: string;
  url: string | null;
  status_processamento: string | null;
  classifica: string | null;
  status_classifica: string | null;
  site: number | null;
  date_created: string | null;
}

export interface DashboardStats {
  sites: {
    total: number;
    ligados: number;
    desligados: number;
    list: Site[];
  };
  leiloes: {
    total: number;
    comImagem: number;
    semImagem: number;
    porTipo: Record<string, number>;
    porUf: Record<string, number>;
    porSite: Record<string, number>;
    publicados: number;
    naoPublicados: number;
  };
  logs: {
    total: number;
    sucesso: number;
    sucessoParcial: number;
    erro: number;
    urlInvalida: number;
    recentLogs: LogScraping[];
  };
  urlConsulta: {
    total: number;
    totalImoveisIndividuais: number;
    processadas: number;
    naoProcessadas: number;
    comErro: number;
    porCategoria: Record<string, number>;
  };
  leiloesTemporal: { date: string; count: number }[];
}

export const leilaoInsertSchema = z.object({
  site: z.number().min(1, "Site é obrigatório"),
  nome_do_anuncio: z.string().optional(),
  descricao: z.string().optional(),
  area_imovel: z.string().optional(),
  tipo_do_imovel: z.string().optional(),
  tipo_de_leilao: z.string().optional(),
  nome_leiloeiro: z.string().optional(),
  valor_avalaiacao_imovel: z.string().optional(),
  praca_1: z.string().optional(),
  praca_2: z.string().optional(),
  praca_3: z.string().optional(),
  valor_praca1: z.string().optional(),
  valor_praca2: z.string().optional(),
  valor_praca3: z.string().optional(),
  link_edital: z.string().optional(),
  link_matricula: z.string().optional(),
  link_anuncio: z.string().optional(),
  link_imagem: z.string().optional(),
  desconto: z.string().optional(),
  numero_do_processo: z.string().optional(),
  valor_leilao: z.string().optional(),
  cep: z.string().optional(),
  cidade: z.string().optional(),
  estado_uf: z.string().optional(),
  logradouro: z.string().optional(),
  bairro: z.string().optional(),
  numero: z.string().optional(),
  status: z.string().optional(),
});

export type LeilaoInsert = z.infer<typeof leilaoInsertSchema>;

export const dashboardStatsSchema = z.object({
  sites: z.object({
    total: z.number(),
    ligados: z.number(),
    desligados: z.number(),
    list: z.array(z.any()),
  }),
  leiloes: z.object({
    total: z.number(),
    comImagem: z.number(),
    semImagem: z.number(),
    porTipo: z.record(z.string(), z.number()),
    porUf: z.record(z.string(), z.number()),
    porSite: z.record(z.string(), z.number()),
    publicados: z.number(),
    naoPublicados: z.number(),
  }),
  logs: z.object({
    total: z.number(),
    sucesso: z.number(),
    sucessoParcial: z.number(),
    erro: z.number(),
    urlInvalida: z.number(),
    recentLogs: z.array(z.any()),
  }),
  urlConsulta: z.object({
    total: z.number(),
    processadas: z.number(),
    naoProcessadas: z.number(),
    comErro: z.number(),
    porCategoria: z.record(z.string(), z.number()),
  }),
  leiloesTemporal: z.array(z.object({
    date: z.string(),
    count: z.number(),
  })),
});
